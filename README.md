Jira Connect

Jira Connect is a Google Apps Script project that integrates Google Sheets with the Jira API. It allows users to manage Jira data directly from a spreadsheet, making it easier to track issues, update statuses, and automate workflows.

Features

Fetch Jira data and display it in a Google Spreadsheet.

Write updates to Jira from the spreadsheet.

Organize Jira data into three different sheets for better management.

Installation

Open your Google Spreadsheet.

Navigate to Extensions > Apps Script.

Copy and paste the contents of this repository into the Apps Script editor.

Save and deploy the script.

Configuration

Set up your Jira API credentials in the script.

Define your Jira instance URL and project key.

Ensure your Google Spreadsheet has the necessary structure to receive and update Jira data.

Main Functions

manageJiraData()

The core function that interacts with Jira API.

Fetches, processes, and updates data in Google Sheets.

write* Functions

Any function starting with write is responsible for writing data to the spreadsheet.

These functions handle different aspects of Jira data and distribute them across three designated sheets.

Usage

Run manageJiraData() to fetch and update Jira information.

Use write* functions to modify or add Jira-related data to the spreadsheet.

Automate script execution using Google Apps Script triggers for periodic updates.

Contributing

Fork this repository.

Create a new branch (feature-branch-name).

Commit your changes.

Push the branch and create a pull request.

License

This project is licensed under the MIT License.

Contact

For any issues or feature requests, open an issue on GitHub or reach out to the repository owner.
