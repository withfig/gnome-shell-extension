
import { exec } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "node:process";
import { promisify } from "node:util";
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

tasks.add(new Task(async () => {
  const resources = new Folder();

  await (promisify(exec))(`cd './resources' && glib-compile-resources --target './resources.gresource' './resources.gresource.xml'`);

  resources.add(
    "fig-gnome-integration.gresource",
    new File(await fs.readFile("./resources/resources.gresource")));

  zip.add("resources", resources);
}));

tasks.add(new Task(async () => {
  const schemas = new Folder();

  try { await fs.rm("./schemas/gschemas.compiled"); } catch { }

  await (promisify(exec))("glib-compile-schemas schemas");
  
  schemas.add(
    "gschemas.compiled",
    new File(await fs.readFile("./schemas/gschemas.compiled")));

  zip.add("schemas", schemas);
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
          const source = await (async () => {
            let source = await fs.readFile(path.join("./src", entry.name), "utf8");
            
            // Remove property declarations from the source, they're only there
            // to aid in type aquisition.
            source = source.replaceAll(/(?<=\s)_[a-zA-Z0-9_\$]*?;/g, "");
            source = source.replaceAll(/(?<=\s)#[a-zA-Z_\$][a-zA-Z0-9_\$]*?;/g, "");
            
            return source;
          })();
          
          const bundled = await (async () => {
            let bundled = "";
            bundled += await banner;
            bundled += "\nconst DEBUG=true;\n";
            bundled += source;
            bundled = bundled.replaceAll(/this.#([a-zA-Z_\$][a-zA-Z0-9_\$]*)/g, (_, ident) => `this.$${ident}`);
            bundled = bundled.replaceAll(/#([a-zA-Z_\$][a-zA-Z0-9_\$]*?)\(/g, (_, ident) => `$${ident}(`);
            return bundled;
          })();

          zip.add(name, new File(bundled));
        } break;
        default: {
          const source = await (async () => {
            let source = await fs.readFile(path.join("./src", entry.name), "utf8");
            
            // Remove property declarations from the source, they're only there
            // to aid in type aquisition.
            source = source.replaceAll(/(?<=\s)_[a-zA-Z0-9_\$]*?;/g, "");
            source = source.replaceAll(/(?<=\s)#[a-zA-Z_\$][a-zA-Z0-9_\$]*?;/g, "");
            
            return source;
          })();

          const minified = (await minify(source, {
            compress: {
              global_defs: {
                DEBUG: false,
              },
              pure_getters: true,
            },
            ecma: 2020,
            mangle: {
              keep_fnames: true,
              toplevel: true,
            },
          })).code;

          const bundled = await (async () => {
            let bundled = "";
            bundled += await banner;
            bundled += minified;
            bundled = bundled.replaceAll(/this.#([a-zA-Z_\$][a-zA-Z0-9_\$]*)/g, (_, ident) => `this.$${ident}`);
            bundled = bundled.replaceAll(/#([a-zA-Z_\$][a-zA-Z0-9_\$]*?)\(/g, (_, ident) => `$${ident}(`);
            return bundled;
          })();

          console.log(bundled);

          zip.add(name, new File(bundled));
        } break;
      }
    }));
  }
}

await tasks.wait();

await zip.save("./fig-gnome-integration@fig.io.zip");

console.log("Extension bundled!");
