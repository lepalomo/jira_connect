/*#####################
MAIN FUNCTIONS
#####################*/

function manageJiraData() {
  console.info("Starting manageJiraData... possibly called by a cron job");

  const jqlQuery = PHM.Spreadsheet.getRangeValues(JQL_QUERY_RANGE);
  const statusMap = PHM.Spreadsheet.getRangeValues(JIRA_STATUS_MAP);
  const statusToCategory = new Map(statusMap.map(([statusId, , category]) => [statusId, category])); //([statusId, , category]) is destructuring an array of (presumably) three elements.

  //maybe any item was created or excluded from Jira while the data was going updated. In this case, lets verify and restart the process
  const verifyTotal = parseInt(makeJiraApiRequest('/search', { jql: jqlQuery, startAt: 0, maxResults: 0 }).total) || 0;
  const storedTotal = parseInt(PHM.Properties.getProp('JIRA_TOTAL_ITEMS_COUNT')) || 0;
  if (verifyTotal !== storedTotal) { resetJiraProcess(); };

  let startAt = parseInt(PHM.Properties.getProp('JIRA_LAST_START_AT'));

  const maxResults = 100;
  const maxBatchSize = 5000;
  const allProcessedIssues = [];
  let itemsFetched = 0;

  console.info(`Fetching next ${maxBatchSize} items, starting at item ${parseInt(startAt)}...`);
  while (getRemainingItems() > 0 && itemsFetched < maxBatchSize) {

    const response = makeJiraApiRequest('/search', {
      jql: jqlQuery,
      startAt: parseInt(startAt),
      maxResults: maxResults,
      fields: "project,issuetype,key,created,customfield_10004,labels,priority,reporter,assignee,components,parent,customfield_10200,customfield_11523,timeoriginalestimate",
      expand: "changelog"
    });

    if (!response || !response.issues || response.issues.length === 0) {
      console.info("No more data returned from Jira");
      break;
    }

    const processedIssues = response.issues.map(issue => extractRelevantFields(issue, statusToCategory));
    allProcessedIssues.push(...processedIssues);
    itemsFetched += processedIssues.length;
    startAt += processedIssues.length;
    subtractRemainingItems(processedIssues.length);
  }

  if (getRemainingItems() > 0) console.info(`${itemsFetched} items fetched. Remaining items to be grabbed: ${getRemainingItems()} from ${getTotalItems()}`);

  if (allProcessedIssues.length > 0) {
    storeData(allProcessedIssues);
    PHM.Properties.setProp('JIRA_LAST_START_AT', parseInt(startAt));
  }

  if (getRemainingItems() <= 0) {
    console.info("All Jira data fetched and stored successfully.");
    nextScriptExecutionStage();
    return
  }
}

function resetJiraProcess() {
  console.info("Resetting Jira process...");
  PHM.Properties.setProp('JIRA_LAST_START_AT', 0);
  // clearing last row property
  PHM.Properties.setProp('JIRA_WIP_LAST_ROW', 2);
  // clearing JSON file
  PHM.Properties.setProp('JIRA_FILE_ID', PHM.Utilities.createAndStoreJSONFile('jira.json', JSON.stringify([])).getId());
  PHM.Properties.setProp('JIRA_WIP_FILE_ID', PHM.Utilities.createAndStoreTextFile('jira_wip.txt', "").getId());
  // retrieving from JIRA API the number of items returned by the JQLQuery passed
  getAndSetupNumberOfItemsFromJQLQuerySearch();
}

function writeJiraWIPData() {
  console.info("Writing JIRA WIP data from TEXT file...");
  const txtFile = PHM.Utilities.openTextFile(PHM.Properties.getProp('JIRA_WIP_FILE_ID'));

  if (!txtFile) {
    PHM.Spreadsheet.logError('writeJiraWIPData', 'Failed to find TXT file', '');
    return;
  }

  const txtContent = txtFile.getBlob().getDataAsString();
  const rows = txtContent.split('\n').map(row => row.split('|||'));
  const rowCount = rows.length;
  const batchSize = 2500;
  const wipSheet = PHM.Spreadsheet.getSheetByName(JIRA_WIP_SHEET_NAME);

  let startRow = parseInt(PHM.Properties.getProp('JIRA_WIP_LAST_ROW')) || 2;
  const endRow = Math.min(startRow + batchSize - 2, rowCount + 1);
  const batch = rows.slice(startRow - 2, endRow);

  console.info(`Writing rows ${startRow} to ${endRow} to WIP sheet.`);

  try {
    wipSheet.getRange(`A${startRow}:AG`).clearContent();
    wipSheet.getRange(startRow, 1, batch.length, 33).setValues(batch);
    PHM.Properties.setProp('JIRA_WIP_LAST_ROW', parseInt(endRow));
  } catch (error) {
    console.error(`Failed to write WIP data to sheet: ${error.message}`);
    return;
  }

  if (endRow - 1 < rowCount) {
    console.info(`Batch written. ${rowCount - (endRow - 1)} rows remaining.`);
  } else {
    PHM.Properties.setProp('JIRA_WIP_LAST_ROW', 2);
    PHM.Properties.setProp('LAST_JIRA_DATA_WRITE_DATE', new Date());
    console.info("WIP data written successfully");
    nextScriptExecutionStage();
  }
}


function writeJiraChangelogData() {
  console.info("We are going to write JIRA CHGLOG");
  //this function must open the JSON file using the PHM Object and read the nodes, writting them on the following sheet
  const changelogSheet = PHM.Spreadsheet.getSheetByName(JIRA_CHG_SHEET_NAME);

  const fileId = PHM.Properties.getProp('JIRA_FILE_ID');
  const file = PHM.Utilities.openJSONFile(fileId);
  if (!file) {
    PHM.Spreadsheet.logError('writeJiraChangelogData', 'Failed to open JSON file', '');
    return;
  }

  const fileDataString = file.getBlob().getDataAsString();
  let data;
  try {
    data = JSON.parse(fileDataString);
  } catch (error) {
    PHM.Spreadsheet.logError('writeJiraChangelogData', 'Failed to parse JSON data', error.stack);
    return;
  }

  if (!data || data.length === 0) {
    PHM.Spreadsheet.logError('writeJiraChangelogData', 'No data to write to changelog sheet', '');
    return;
  }

  let rows = [];
  data.forEach(issue => {
    // Created Date
    rows.push([
      `jira-${issue.key}`, // ISSUE KEY
      issue.createdDate, // DATE
      'jira', // TOOL
      `${issue.project.key} | ${issue.project.name}`, // PROJECT NAME
      issue.squad, // SQUAD
      `${issue.reporter.displayName}`, // AUTHOR
      `criação de ${issue.issuetype.name}`, // ACTION
      `item ${issue.key} criado por ${issue.reporter.displayName}` // DETAIL
    ]);

    // Changelog Histories
    if (issue.transitions) {
      issue.transitions.forEach(transition => {
        rows.push([
          `jira-${issue.key}`, // ISSUE KEY
          transition.date, // DATE
          'jira', // TOOL
          `${issue.project.key} | ${issue.project.name}`, // PROJECT NAME
          issue.squad, // SQUAD
          `${transition.userName}`, // AUTHOR
          `movimentação de ${issue.issuetype.name}`, // ACTION
          `item jira-${issue.key} foi para: ${transition.to}` // DETAIL
        ]);
      });
    }
  });

  if (rows.length > 0) {
    changelogSheet.getRange("A2:H").clearContent();
    changelogSheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
    console.info(`Wrote ${rows.length} rows to changelog sheet`);
  } else {
    console.info("No data to write to changelog sheet");
  }

  return rows.length;
}

function writeOpCostData() {
  console.info("Writing operational cost data from TEXT file...");
  const txtFile = PHM.Utilities.openTextFile(PHM.Properties.getProp('JIRA_WIP_FILE_ID'));

  if (!txtFile) {
    console.error('writeOpCostData', 'Failed to find TXT file', '');
    return;
  }

  const txtContent = txtFile.getBlob().getDataAsString();
  const rows = txtContent.split('\n').map(row => row.split('|||'));
  const opCostSheet = PHM.Spreadsheet.getSheetByName(OP_COST_SHEET_NAME);

  // Criar mapa de relações parent-child
  const parentMap = {};
  const issueMap = {};

  rows.forEach(issue => {
    const key = issue[3]; // Chave do item
    const parent = issue[7]; // Chave do parent (se houver)
    if (key) parentMap[key] = parent;
    issueMap[key] = issue; // Mapear os itens por chave para consultas rápidas
  });

  // Função para resolver a hierarquia completa de um item
  function resolveHierarchy(key) {
    let epic = "";
    let initiative = "";
    let keyResult = "";
    let objective = "";
    let story = "";

    let current = key;
    while (current && parentMap[current]) {
      const parent = parentMap[current];
      const parentIssue = issueMap[parent];

      if (!parentIssue) break;

      const parentType = parentIssue[1].toLowerCase(); // Tipo do parent

      if (parentType === "epic") epic = parent;
      else if (parentType === "história") story = parent;
      else if (parentType === "iniciativa") initiative = parent;
      else if (parentType === "resultado chave") keyResult = parent;
      else if (parentType === "objetivo") objective = parent;

      current = parent; // Subir na hierarquia
    }

    return { story, epic, initiative, keyResult, objective };
  }

  const values = [];
  rows.forEach(issue => {
    const [
      projectKey, issuetypeName, squad, key, storyPoints, labels, components, parent, parentSummary, priorityName,
      createdDate, startedDate, doneDate, reactionTime, cycleTime, leadTime, restartedDate, backlogTime, readyToStartTime,
      inProgressTime, codeReviewTime, waitingQaTime, qaTime, readyToStagingTime, regressionTime, readyToDeployTime,
      readyForVersionTime, distributeProcessTime, doneTime, assigneeDisplayName, testerDisplayName, designerDisplayName, timeOriginalEstimate
    ] = issue;

    if (assigneeDisplayName && (cycleTime || timeOriginalEstimate) && 
        (issuetypeName.toLowerCase() === 'tarefa' || 
         issuetypeName.toLowerCase() === 'subtarefa' || 
         issuetypeName.toLowerCase() === 'bug')) {

      const itemType = issuetypeName.toLowerCase();

      // Resolver hierarquia completa
      const { story, epic, initiative, keyResult, objective } = resolveHierarchy(key);

      const row = [
        objective, keyResult, initiative, '', '', key, squad, assigneeDisplayName, itemType, '', startedDate, doneDate, timeOriginalEstimate, cycleTime, '', ''
      ];

      if (itemType === "história") {
        row[4] = key; // Histórias ficam na coluna E
      } else if (itemType === "subtarefa") {
        row[4] = story; // Subtarefas ficam na história correspondente
      } else if (itemType === "tarefa" || itemType === "bug") {
        row[3] = epic; // Tarefas e bugs ficam no épico
      }

      // Implementar a coluna 'opex'
      row[9] = itemType === 'bug' ? true : false;

      // Obter peso salarial e calcular custo
      const incomeWeight = PHM.Utilities.getIncomeWeightForPerson(assigneeDisplayName);
      const hourlyRate = incomeWeight / 200;
      if (hourlyRate > 0) {
        if (timeOriginalEstimate !== '') row[14] = hourlyRate * timeOriginalEstimate;
        if (cycleTime !== '') row[15] = hourlyRate * cycleTime;
      }

      values.push(row);
    }
  });

  console.info(`Writing ${values.length} rows to operational cost sheet.`);

  if (values.length > 0) {
    opCostSheet.getRange("A2:R").clearContent();
    opCostSheet.getRange(2, 1, values.length, 16).setValues(values);
    console.info("Operational cost data written successfully");
  } else {
    console.info("No data to write to operational cost sheet");
  }
}

/*#####################
AUXILIAR FUNCTIONS
#####################*/

function storeData(data) {
  console.info(`Attempting to store ${data.length} nodes on JSON file.`);
  let file = PHM.Utilities.openJSONFile(PHM.Properties.getProp('JIRA_FILE_ID'));
  let jsonFileData = file ? JSON.parse(file.getBlob().getDataAsString()) : [];

  jsonFileData.push(...data);

  try {
    if (file) {
      file.setContent(JSON.stringify(jsonFileData, null, 2));
    } else {
      file = PHM.Utilities.createAndStoreJSONFile('jira.json', JSON.stringify(jsonFileData, null, 2));
      PHM.Properties.setProp('JIRA_FILE_ID', file.getId());
    }
    console.info(`Data stored on JSON file. New size: ${jsonFileData.length} nodes`);
  } catch (error) {
    console.error(`Failed to create and store new JSON file: ${error.message}`);
  }
  // Storing data in text file
  let txtContent = data.map(issue =>
    `${issue.project.key}|||` +
    `${issue.issuetype.name}|||` +
    `${issue.squad || ''}|||` +
    `${issue.key}|||` +
    `${issue.storyPoints || ''}|||` +
    `${issue.labels ? issue.labels.join(', ') : ''}|||` +
    `${issue.components ? issue.components.join(', ') : ''}|||` +
    `${issue.parent || ''}|||` +
    `${issue.parent_summary || ''}|||` +
    `${issue.priority?.name || ''}|||` +
    `${issue.createdDate || ''}|||` +
    `${issue?.startedDate || ''}|||` +
    `${issue?.doneDate || ''}|||` +
    `${issue?.reactionTime || ''}|||` +
    `${issue?.cycleTime || ''}|||` +
    `${issue?.leadTime || ''}|||` +
    `${issue.restartedDate?.date || ''}|||` +
    `${issue.transitions_times?.backlog_time || ''}|||` +
    `${issue.transitions_times?.ready_to_start_time || ''}|||` +
    `${issue.transitions_times?.in_progress_time || ''}|||` +
    `${issue.transitions_times?.code_review_time || ''}|||` +
    `${issue.transitions_times?.waiting_qa_time || ''}|||` +
    `${issue.transitions_times?.qa_time || ''}|||` +
    `${issue.transitions_times?.ready_to_staging_time || ''}|||` +
    `${issue.transitions_times?.regression_time || ''}|||` +
    `${issue.transitions_times?.ready_to_deploy_time || ''}|||` +
    `${issue.transitions_times?.ready_for_version_time || ''}|||` +
    `${issue.transitions_times?.distribute_process_time || ''}|||` +
    `${issue.transitions_times?.done_time || ''}|||` +
    `${issue.assignee?.displayName || ''}|||` +
    `${issue.tester?.displayName || ''}|||` +
    `${issue.designer?.displayName || ''}|||` +
    `${issue.timeoriginalestimate || ''}`
  ).join('\n');
  // console.log(`TXT Content: `,txtContent);
  try {
    let file = PHM.Utilities.openTextFile(PHM.Properties.getProp('JIRA_WIP_FILE_ID'));
    let currentContent = file ? file.getBlob().getDataAsString() : null;
    let newContent = currentContent ? currentContent + '\n' + txtContent : txtContent;
    if (file) {
      file.setContent(newContent);
      console.info(`Data updated on existing text file. File size: ${file.getSize()}`);
    } else {
      file = PHM.Utilities.createAndStoreTextFile('jira_wip.txt', newContent);
      PHM.Properties.setProp('JIRA_WIP_FILE_ID', file.getId());
      console.info(`Data stored on new text file. File size: ${file.getSize()}`);
    }
  } catch (error) {
    console.error(`Failed to create or update text file: ${error.message}`);
  }
}

function getAndSetupNumberOfItemsFromJQLQuerySearch() {
  const jqlQuery = PHM.Spreadsheet.getRangeValues(JQL_QUERY_RANGE);
  try {
    const response = makeJiraApiRequest('/search', { jql: jqlQuery, startAt: 0, maxResults: 0 });
    PHM.Properties.setProp('JIRA_REMAINING_ITEMS_COUNT', parseInt(response.total));
    PHM.Properties.setProp('JIRA_TOTAL_ITEMS_COUNT', parseInt(response.total));
    console.info(`The total number of items to grab is ${response.total}`);
  } catch (error) {
    console.warn("Can't discover number of items to grab");
  }
}

function getRemainingItems() {
  return PHM.Properties.getProp('JIRA_REMAINING_ITEMS_COUNT');
}

function getTotalItems() {
  return PHM.Properties.getProp('JIRA_TOTAL_ITEMS_COUNT');
}

function subtractRemainingItems(value) {
  const remainingItemsCount = Math.max(0, getRemainingItems() - value);
  PHM.Properties.setProp('JIRA_REMAINING_ITEMS_COUNT', remainingItemsCount);
  return remainingItemsCount;
}

function extractRelevantFields(issue, statusToCategory) {
  const result = {}

  result.id = issue.id;
  result.key = issue.key;
  const creationDate = new Date(issue.fields.created);
  result.createdDate = PHM.DateUtils.formatDate(creationDate, true);

  let tt = calculateTransitionTimes(issue.changelog);

  tt = Object.keys(tt).reduce((acc, status) => {
    const category = statusToCategory.get(status);
    if (category) {
      if (acc[category]) {
        acc[category] += tt[status];
      } else {
        acc[category] = tt[status];
      }
    }
    return acc;
  }, {});

  const firstStatusChange = issue.changelog.histories.some(item => item.field === 'status' && statusToCategory.get(item.from) === '10002');
  if (firstStatusChange) {
    const firstStatusChangeDate = new Date(firstStatusChange.created);
    const backlogTime = PHM.DateUtils.calculateDuration(creationDate, firstStatusChangeDate);
    tt['backlog_time'] = backlogTime;
  }

  let startedDate = getTransitionDate(issue.changelog, 'in_progress_time', statusToCategory);

  let doneDate = getTransitionDate(issue.changelog, 'done_time', statusToCategory);


  result.transitions_times = tt;

  let reactionTime = null;
  if (startedDate) {
    reactionTime = PHM.DateUtils.calculateDuration(creationDate, startedDate);
    result.reactionTime = reactionTime
    result.startedDate = PHM.DateUtils.formatDate(startedDate, true);
  }

  let leadTime = null;
  if (doneDate) {
    leadTime = PHM.DateUtils.calculateDuration(creationDate, doneDate);
    result.doneDate = PHM.DateUtils.formatDate(doneDate, true);
    result.leadTime = leadTime;
  }

  let cycleTime = null;
  if (startedDate && doneDate) {
    cycleTime = PHM.DateUtils.calculateDuration(startedDate, doneDate);
    result.cycleTime = cycleTime;
  }

  const backlogHistories = issue.changelog.histories.filter(history =>
    history.items.some(item => item.field === 'status' && statusToCategory.get(item.to) === 'backlog_time')
  );

  if (backlogHistories.length > 1) {
    result.restartedDate = PHM.DateUtils.formatDate(backlogHistories[backlogHistories.length - 1].created, true);
  }

  if (issue.fields.customfield_10004) result.storyPoints = issue.fields.customfield_10004;

  if (issue.fields.issuetype) {
    result.issuetype = {
      id: issue.fields.issuetype.id,
      name: issue.fields.issuetype.name
    };
  }

  if (issue.fields.project) {
    result.project = {
      id: issue.fields.project.id,
      key: issue.fields.project.key,
      name: issue.fields.project.name
    };
  }

  if (issue.fields.reporter) {
    result.reporter = {
      displayName: PHM.Utilities.updateUsername(issue.fields.reporter.displayName, USER_DICTIONARY) || PHM.Utilities.updateUsername(issue.fields.reporter.emailAddress, USER_DICTIONARY) || issue.fields.reporter.displayName + "*",
      active: issue.fields.reporter.active
    };
  }

  if (issue.fields.assignee) {
    result.assignee = {
      displayName: PHM.Utilities.updateUsername(issue.fields.assignee.displayName, USER_DICTIONARY) || PHM.Utilities.updateUsername(issue.fields.assignee.emailAddress, USER_DICTIONARY) || issue.fields.assignee.displayName + "*",
      active: issue.fields.assignee.active
    };
  }

  if (issue.fields.customfield_10200) {
    result.tester = {
      displayName: PHM.Utilities.updateUsername(issue.fields.customfield_10200.displayName, USER_DICTIONARY) || PHM.Utilities.updateUsername(issue.fields.customfield_10200.emailAddress, USER_DICTIONARY) || issue.fields.customfield_10200.displayName + "*",
      active: issue.fields.customfield_10200.active
    };
  }

  if (issue.fields.customfield_11523) {
    result.designer = {
      displayName: PHM.Utilities.updateUsername(`${issue.fields.customfield_11523.displayName | issue.fields.customfield_11523.emailAddress}`, USER_DICTIONARY),
      active: issue.fields.customfield_11523.active
    };
  }

  const squad = squadByJiraProjectKey(issue.fields.project.key);
  if (squad) result.squad = squad;

  if (issue.fields.timeoriginalestimate) result.timeoriginalestimate = Math.ceil(parseInt(issue.fields.timeoriginalestimate) / 3600);

  if (issue.fields.labels?.length) {
    result.labels = issue.fields.labels;
  }

  if (issue.fields.components?.length) {
    result.components = issue.fields.components.map(c => c.name);
  }

  if (issue.fields.parent) {
    result.parent = issue.fields.parent.key;
    if (issue.fields.parent.fields?.summary) {
      result.parent_summary = issue.fields.parent.fields.summary.replace(/\n/g, " ");
    }
  }

  if (issue.fields.priority) {
    result.priority = {
      id: issue.fields.priority.id,
      name: issue.fields.priority.name
    };
  }
  if (issue.changelog?.histories?.length) {
    result.transitions = issue.changelog.histories
      .filter(history => history.items.some(item => item.field === 'status'))
      .map(history => {
        const statusChange = history.items.find(item => item.field === 'status');
        const statusCategory = statusToCategory.get(statusChange.to);
        const cleanStatus = statusCategory ? statusCategory.replace(/_time$/, '') : statusChange.toString;
        return {
          to: cleanStatus,
          date: PHM.DateUtils.formatDate(history.created, true),
          userName: PHM.Utilities.updateUsername(history.author.displayName, USER_DICTIONARY) || PHM.Utilities.updateUsername(history.author.emailAddress, USER_DICTIONARY) || history.author.displayName + "*",
          isActiveUser: history.author.active
        };
      });
  }

  return result;
}


function calculateTransitionTimes(changelog) {
  let transitions = [];

  // Step 1: Extract status transitions and timestamps
  changelog.histories.forEach(history => {
    let timestamp = new Date(history.created).getTime(); // Convert to milliseconds
    history.items.forEach(item => {
      if (item.field === "status") {
        transitions.push({
          from: item.from,
          to: item.to,
          timestamp: timestamp
        });
      }
    });
  });

  // Step 2: Sort transitions by timestamp (oldest first)
  transitions.sort((a, b) => a.timestamp - b.timestamp);

  // Step 3: Calculate time spent in each status
  let transitionTimes = {};
  for (let i = 0; i < transitions.length - 1; i++) {
    let status = transitions[i].to;  // The status the item moved into
    let timeSpent = PHM.DateUtils.calculateDuration(transitions[i].timestamp, transitions[i + 1].timestamp); // Calculate duration in working hours

    if (transitionTimes[status]) {
      transitionTimes[status] += timeSpent;
    } else {
      transitionTimes[status] = timeSpent;
    }
  }
  // console.log(JSON.stringify(transitionTimes, null, 2));
  return transitionTimes;
}

function getTransitionDate(changelog, targetStatus, statusToCategory) {
  if (!changelog?.histories?.length) return null;

  for (const history of changelog.histories) {
    for (const item of history.items) {
      if (item.field === 'status' && statusToCategory.get(item.to) === targetStatus) {
        return new Date(history.created);
      }
    }
  }
  return null;
}

function squadByJiraProjectKey(projectKey) {
  const squadMapping = PHM.Spreadsheet.getRangeValues(JIRA_PROJECT_IDS_SQUADS);

  // Verifica se os dados foram carregados corretamente
  if (!squadMapping || squadMapping.length === 0) {
    throw new Error("Jira squad mapping data is empty or could not be retrieved.");
  }

  // Itera sobre o range para encontrar o squad correspondente
  for (let i = 0; i < squadMapping.length; i++) {
    const [project, squad] = squadMapping[i];
    if (project === projectKey) {
      return squad;
    }
  }

  // Retorna null caso o projeto não seja encontrado
  return null;
}

function makeJiraApiRequest(endpoint, params) {
  let url = `https://${JIRA_ACCOUNT}.atlassian.net/rest/api/${JIRA_API_VERSION}${endpoint}`;
  const options = {
    method: DEFAULT_HTTP_METHOD,
    headers: {
      "Authorization": `Basic ${Utilities.base64Encode(`${JIRA_EMAIL}:${JIRA_TOKEN}`)}`,
      "Content-Type": "application/json"
    },
    muteHttpExceptions: true
  };

  if (params) {
    url += '?' + Object.keys(params).map(key => `${key}=${encodeURIComponent(params[key])}`).join('&');
  }

  try {
    const response = UrlFetchApp.fetch(url, options);
    return JSON.parse(response.getContentText());
  } catch (error) {
    console.error(error.stack, error.message);
  }
}