
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "node:process";
import { minify } from "terser";

import { Task, TaskSet } from "./tasks.js";
import { File, Folder, Zip } from "./zip.js";

console.log("Bundling extension...");

const banner = (async () => await fs.readFile("./src/banner.js", "utf8"))();
const tasks = new TaskSet();
const zip = new Zip();

tasks.add(new Task(async () => {
  const metadata = await fs.readFile('./src/metadata.json', "utf8");
  zip.add("metadata.json", new File(metadata));
}));

for await (const entry of await fs.opendir("./src")) {
  if (entry.isFile()) {
    if (!entry.name.endsWith(".js")) continue;
    if (entry.name == "banner.js") continue;
    
    const name = entry.name != "preferences.js" ? entry.name : "prefs.js";

    tasks.add(new Task(async () => {
      switch (env.RELEASE) {
        case "0":
        case "false":
        case undefined: {
          const source = await fs.readFile(path.join("./src", entry.name), "utf8");
          
          const bundled = await (async () => {
            let bundled = "";
            bundled += await banner;
            bundled += "\nconst DEBUG=true;\n";
            bundled += source;
            return bundled;
          })();

          zip.add(name, new File(bundled));
        } break;
        default: {
          const source = await fs.readFile(path.join("./src", entry.name), "utf8");

          const minified = (await minify(source, {
            compress: {
              global_defs: {
                DEBUG: false,
              },
            },
            mangle: {
              reserved: [ "Gio", "GLib", "global", "GObject", "imports", "init", "Meta" ],
              toplevel: true,
              properties: /^(_|Item|Queue)/,
            },
            format: {
              max_line_len: 80,
            },
          })).code;

          const bundled = await (async () => {
            let bundled = "";
            bundled += await banner;
            bundled += minified;
            return bundled;
          })();

          zip.add(name, new File(bundled));
        } break;
      }
    }));
  }
}

await tasks.wait();

await zip.save("./fig-gnome-integration@fig.io.zip");

console.log("Extension bundled!");
