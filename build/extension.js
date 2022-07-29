
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "node:process";
import { minify } from "terser";

const banner = (async () => await fs.readFile("./src/banner.js", "utf8"))();

const tasks = [ ];

for await (const entry of await fs.opendir("./src")) {
  if (entry.isFile()) {
    if (!entry.name.endsWith(".js")) continue;
    if (entry.name == "banner.js") continue;
    
    tasks.push((async () => {
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

          console.log(bundled);

          // TODO: SAVE FILE TO ZIP
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
              reserved: [ "imports", "init" ],
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

          console.log(bundled);

          // TODO: SAVE FILE TO ZIP
        } break;
      }
    })());
  }
}
