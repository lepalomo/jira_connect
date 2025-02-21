// PHM - Project Helper Methods
var PHM = {
  Spreadsheet: {
    getBatchRangesValues: function (...ranges) {
      if (ranges.length === 0) {
        throw new Error("At least one range must be provided.");
      }
      try {
        const response = Sheets.Spreadsheets.Values.batchGet(SPREADSHEET_ID, { ranges: ranges });
        return response.valueRanges.map(range => range.values || []);
      } catch (error) {
        throw new Error(`Failed to fetch batch range values: ${error.message}`);
      }
    },
    getRangeValues: function (range) {
      let [sheetName, cellRange] = range.split('!');
      const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(sheetName);
      if (!sheet) {
        throw new Error(`Sheet "${sheetName}" not found.`);
      }
      if (cellRange.match(/:[a-zA-Z]{1,2}$/)) {
        const lastRow = sheet.getLastRow();
        cellRange = cellRange + lastRow;
      }

      let rangeValues = sheet.getRange(cellRange).getValues();
      while (rangeValues.length > 0 && rangeValues[rangeValues.length - 1].every(cell => cell === '')) {
        rangeValues.pop();
      }
      return rangeValues.length === 1 && rangeValues[0].length === 1 ? rangeValues[0][0] : rangeValues;
    },

    getSheetByName: function (sheetName) {
      try {
        const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
        if (!spreadsheet) {
          throw new Error(`Failed to get active spreadsheet`);
        }

        const sheet = spreadsheet.getSheetByName(sheetName);
        if (!sheet) {
          throw new Error(`Sheet not found: ${sheetName}`);
        }

        return sheet;
      } catch (error) {
        throw new Error(`Failed to get sheet "${sheetName}": ${error.message}`);
      }
    },
    getFullNames: function () {
      return this.getRangeValues(PEOPLE_SHEET_NAME, 'A2:A').flat();
    },
    logError: function (functionName, errorMessage, additionalInfo) {
      const timestamp = new Date().toISOString();
      const logData = [timestamp, functionName, errorMessage, JSON.stringify(additionalInfo)];
      this.appendRow(ERROR_LOG_SHEET_NAME, logData);
    },
    logNote: function (sheetName, note) {
      const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
      const sheet = spreadsheet.getSheetByName(sheetName);
      if (sheet) {
        sheet.getRange('A1').setNote(note);
      }
    },
    appendRow: function (sheetName, rowData) {
      const sheet = this.getSheetByName(sheetName);
      if (sheet) {
        sheet.appendRow(rowData);
      }
    },
    filterEmptyRows: function (data) {
      return data.filter(row => row[0] !== '');
    },
    getSheetId: function (sheetName) {
      return SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(sheetName).getSheetId();
    },
    setRangeValues: function (range, values) {
      console.info(`Setting range values for range: ${range}`);
      const [sheetName, cellRange] = range.split('!');
      console.info(`Sheet name: ${sheetName}, Cell range: ${cellRange}`);

      const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(sheetName);
      if (!sheet) {
        const error = `Sheet "${sheetName}" not found.`;
        console.error(error);
        throw new Error(error);
      }

      try {
        sheet.getRange(cellRange).setValues(values);
        console.info('Range values set successfully');
      } catch (error) {
        console.error(`Failed to set range values: ${error.message}`);
        throw error;
      }
    },
    setBatchRangesValues: function (rangesValues) {
      const requests = rangesValues.map(({ updateCells }) => {
        const { range, rows, fields } = updateCells;
        return {
          updateCells: {
            range: {
              sheetId: range.sheetId,
              startRowIndex: range.startRowIndex,
              endRowIndex: range.endRowIndex,
              startColumnIndex: range.startColumnIndex,
              endColumnIndex: range.endColumnIndex
            },
            rows: rows.map(row => ({
              values: row.values.map(cell => ({
                userEnteredValue: { numberValue: cell.userEnteredValue.numberValue }
              }))
            })),
            fields: fields
          }
        };
      });

      return Sheets.Spreadsheets.batchUpdate({
        requests: requests
      }, SPREADSHEET_ID);
    }
  },
  Properties: {
    getProp: function (key) {
      var sp = PropertiesService.getScriptProperties();
      var value = sp.getProperty(key);
      if (value && (value.startsWith('[') || value.startsWith('{'))) {
        value = JSON.parse(value);
      } else if (typeof value === 'string' && value.startsWith('\"') && value.endsWith('\"')) {
        value = PHM.Utilities.removeDoubleQuotes(value);
      }
      return value;
    },
    setProp: function (key, value) {
      var sp = PropertiesService.getScriptProperties();
      if (value && typeof value === 'object') {
        value = JSON.stringify(value);
      }
      sp.setProperty(key, value);
      return sp.getProperty(key);
    },
    hasProp: function (key) {
      var sp = PropertiesService.getScriptProperties();
      return sp.getProperty(key) !== null;
    }
  },
  Utilities: {
    removeDoubleQuotes: function (str) {
      return str.replace(/^"(.*)"$/, '$1');
    },
    clearCache: function () {
      CacheService.getScriptCache().removeAll([]);
      CacheService.getDocumentCache().removeAll([]);
      CacheService.getUserCache().removeAll([]);
    },
    log: function (...msg) {
      try {
        console.log(JSON.stringify(msg));
      } catch (e) {
        console.log(msg.join(' | '));
      }
    },
    logPrettyJson: function (jsonObject) {
      try {
        console.log(JSON.stringify(jsonObject, null, 2));
      } catch (e) {
        console.error('Error logging JSON:', e.message);
      }
    },
    createAndStoreJSONFile: function (fileName, data) {
      var folder = DriveApp.getRootFolder();
      var files = folder.getFilesByName(fileName);
      var file;
      if (files.hasNext()) {
        file = files.next();
        file.setContent(data);
      } else {
        file = folder.createFile(fileName, data, 'application/json');
      }
      let fileID;
      try {
        fileID = file.getId();
      } catch (error) {
        console.warn('Error getting file ID:', error.message);
        return null;
      }
      return file;
    },
    openJSONFile: function (fileId) {
      try {
        var file = DriveApp.getFileById(fileId);
        return file;
      } catch (error) {
        console.warn('Error opening JSON file:', error.message);
        return null;
      }
    },
    createAndStoreTextFile: function (fileName, data) {
      var folder = DriveApp.getRootFolder();
      var files = folder.getFilesByName(fileName);
      var file;
      if (files.hasNext()) {
        file = files.next();
        file.setContent(data);
      } else {
        file = folder.createFile(fileName, data, 'text/plain');
      }
      let fileID;
      try {
        fileID = file.getId();
      } catch (error) {
        console.warn('Error getting file ID:', error.message);
        return null;
      }
      return file;
    },
    openTextFile: function (fileId) {
      try {
        var file = DriveApp.getFileById(fileId);
        return file;
      } catch (error) {
        console.warn('Error opening text file:', error.message);
        return null;
      }
    },
    countNodesInJSONFile(fileID) {
      const file = PHM.Utilities.openJSONFile(fileID);
      try {
        const fileContent = file.getBlob().getDataAsString();
        const jsonFileData = JSON.parse(fileContent);
        return jsonFileData.length;
      } catch (error) {
        console.warn('Error counting nodes in JSON file:', error.message);
        return null;
      }
    },
    extractIDNumber: function (str) {
      var match = str.match(/\d+/);
      if (!match) {
        return str;
      }
      return match[0];
    },
    handleError: function (error, context) {
      console.error(`Error in ${context}:`, error.message);
      throw error;
    },
    createDictionaryFromTwoRanges: function (keyRange, valueRange) {
      try {
        keyRange = String(keyRange);
        valueRange = String(valueRange);
      } catch (error) {
        throw new Error(`Failed to convert ranges to strings: ${error.message}`);
      }

      // Fetch both ranges in a single batch request
      const [keys, values] = PHM.Spreadsheet.getBatchRangesValues(keyRange, valueRange);

      const dictionary = new Map();
      keys.forEach((key, index) => {
        if (values[index]) {
          dictionary.set(key[0], values[index][0]);
        }
      });

      return dictionary;
    },
    setTrigger: function (functionName, timeInMinutes) {
      ScriptApp.newTrigger(functionName)
        .timeBased()
        .after(timeInMinutes * 60 * 1000) // Convert minutes to milliseconds
        .create();
      console.info(`set a trigger to run ${functionName} after ${timeInMinutes} minutes`)
    },
    updateUsername: function (username, userDictionary) {
      if (!username) return null;
      const lowercaseUsername = username.toLowerCase();
    
      for (const key of userDictionary.keys()) { // Correct iteration for a Map
        if (key.toLowerCase() === lowercaseUsername) {
          return userDictionary.get(key); // Return the corresponding user name
        }
      }
      return null;
    },    
    getIncomeWeightForPerson: function (username) {
      if(typeof username != 'string') return null;
      return parseFloat(INCOME_WEIGHT_DICT.get(username)) || 0; // Use get method
    },
  },
  DateUtils: {
    formatDate: function (dateString, asString = false, onlyDate = false) {
      if (!dateString) return '';

      const date = new Date(dateString);

      // For Google Sheets compatibility, return the original Date object if not converting to string
      if (!asString) {
        return date;
      }

      // Formatting for string representation
      const day = date.getDate().toString().padStart(2, '0');
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const year = date.getFullYear();

      if (onlyDate) {
        // Format compatible with Google Sheets date input
        return `${day}/${month}/${year}`;
      } else {
        // Full datetime format
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        return `${day}/${month}/${year} ${hours}:${minutes}`;
      }
    },
    calculateDuration: function (startQueueDateTime, endQueueDateTime) {
      const workDayStart = 9; // 9 AM
      const workDayEnd = 18; // 6 PM
      const hoursPerDay = workDayEnd - workDayStart;

      startQueueDateTime = new Date(startQueueDateTime);
      endQueueDateTime = new Date(endQueueDateTime);

      if (isNaN(startQueueDateTime.getTime()) || isNaN(endQueueDateTime.getTime())) {
        throw new Error(`Invalid date input. Given: startQueueDateTime - ${startQueueDateTime}, endQueueDateTime - ${endQueueDateTime}`);
      }

      let totalWorkingHours = 0;
      let currentDate = new Date(startQueueDateTime);

      while (currentDate <= endQueueDateTime) {
        const currentDayStr = currentDate.toDateString();

        // Skip weekends and holidays
        if (currentDate.getDay() !== 0 && currentDate.getDay() !== 6 && !HOLIDAYS_SET.has(currentDayStr)) {
          let startHour = (this.isDateEqual(currentDate, startQueueDateTime))
            ? startQueueDateTime.getHours()
            : workDayStart;
          let endHour = (this.isDateEqual(currentDate, endQueueDateTime))
            ? endQueueDateTime.getHours()
            : workDayEnd;

          // Ensure valid working hours
          startHour = Math.max(startHour, workDayStart);
          endHour = Math.min(endHour, workDayEnd);

          if (endHour > startHour) {
            totalWorkingHours += endHour - startHour;
          }
        }

        // Move to the next day
        currentDate.setDate(currentDate.getDate() + 1);
      }

      totalWorkingHours = Math.max(totalWorkingHours, 1);
      return Math.round(totalWorkingHours * 100) / 100;
    },
    batchCalculateDuration: function (startEndDates) {
      // Sort the start and end dates by date
      startEndDates.sort((a, b) => a.date - b.date);

      // Initialize an array to hold the durations
      const durations = [];

      // Initialize the start date
      let startDate;

      // Iterate over the sorted start and end dates
      startEndDates.forEach((date) => {
        // If the date is a start date, set the start date
        if (date.type === 'start') {
          startDate = date.date;
        }
        // If the date is an end date and a start date has been set, calculate the duration
        else if (date.type === 'end' && startDate) {
          const duration = this.calculateDuration(startDate, date.date);
          durations.push(duration);
          // Reset the start date
          startDate = null;
        }
      });

      // Return the calculated durations
      return durations;
    },
    countWeekendDays: function (startDate, endDate) {
      let weekendDays = 0;
      let currentDate = new Date(startDate.getTime());

      while (currentDate <= endDate) {
        if (currentDate.getDay() === 0 || currentDate.getDay() === 6) {
          weekendDays++;
        }
        currentDate.setDate(currentDate.getDate() + 1);
      }
      return weekendDays;
    },
    countHolidayDays: function (startDate, endDate, holidays) {
      let holidayDays = 0;
      let currentDate = new Date(startDate.getTime());

      while (currentDate <= endDate) {
        if (holidays.some(holiday => this.isDateEqual(currentDate, new Date(holiday)))) {
          holidayDays++;
        }
        currentDate.setDate(currentDate.getDate() + 1);
      }
      return holidayDays;
    },
    isDateEqual: function (date1, date2) {
      if (!(date1 instanceof Date) || !(date2 instanceof Date)) {
        throw new Error("Both parameters must be valid Date objects.");
      }
      return date1.getFullYear() === date2.getFullYear() &&
        date1.getMonth() === date2.getMonth() &&
        date1.getDate() === date2.getDate();
    }
  }
};
