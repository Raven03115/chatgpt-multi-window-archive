const { app } = require("electron");
const fs = require("fs");
const path = require("path");

const USER_DATA_PATH = path.join(
  app.getPath("appData"),
  "chatgpt-multi-window"
);

const CONFIG_PATH = path.join(
  USER_DATA_PATH,
  "multi-pane-layout-config.json"
);

app.setPath("userData", USER_DATA_PATH);

try {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.mkdirSync(USER_DATA_PATH, {
      recursive: true
    });

    fs.writeFileSync(
      CONFIG_PATH,
      JSON.stringify(
        {
          paneCount: 1,
          paneUrls: []
        },
        null,
        2
      ),
      "utf8"
    );
  }
} catch (error) {
  console.error(
    "[Bootstrap v4.5.4.2 Beta 6] failed to create default layout config:",
    error.message
  );
}

require("./poc-shaped-sidebar-v4.5.4.js");
