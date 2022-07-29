
import { Buffer } from "node:buffer";
import { exec } from "node:child_process";
import path from "node:path";
import { cwd, env, getuid } from "node:process";
import fs from "node:fs/promises";
import { promisify } from "node:util";

import { Task, TaskSet } from "./tasks.js";

const run = (() => {
  const aexec = promisify(exec);
  return async (command) => {
    return (await aexec(command)).stdout.trim();
  };
})();

export class Zip {
  /** @static @public @property @type {unique symbol} */
  static write_to_intermittent_directory_as = Symbol("write_to_intermittent_directory_as");

  /** @private @property @type {Folder} */
  #root = new Folder();

  /** @public @method @param {string} name @param {File|Folder} member @returns {Zip} */
  add(name, member) { this.#root.add(name, member); return this; }

  async save(file) {
    const directory = await (async () => {
      if (env.XDG_RUNTIME_DIR != undefined) {
        return await run(`mktemp --directory '${env.XDG_RUNTIME_DIR}/fig-gse-build-temp-XXXX'`);
      }

      try {
        return await run(`mktemp --directory '/run/user/${getuid()}/fig-gse-build-temp-XXXX'`);
      } catch {
        return await run(`mktemp --directory 'fig-gse-build-temp-XXXX'`);
      }
    })();

    await this.#root[Zip.write_to_intermittent_directory_as](directory);

    if (!file.startsWith("/")) {
      file = path.join(cwd(), file);
    }

    try { await fs.rm(file); } catch { }

    await run(`sh -c $'cd \\'${directory}\\' && zip \\'${file}\\' $(find -type f | sed \\'s/^.\\///g\\') && rm -rf \\'${directory}\\''`);
  }
}

export class File {
  /** @private @property @type {string|Buffer} */
  #content;

  /** @public @constructor @param {string|Buffer} content */
  constructor(content) {
    if (!(typeof content == "string") && !(content instanceof Buffer)) {
      throw new TypeError("content must be a string or Buffer.");
    }
    
    this.#content = content;
  }

  /** @public @async @method @param {string} file @returns {Promise<void>} */
  async [Zip.write_to_intermittent_directory_as](file) {
    if (typeof this.#content == "string") {
      await fs.writeFile(file, this.#content, "utf8");
    }

    if (this.#content instanceof Buffer) {
      await fs.writeFile(file, this.#content);
    }
  }
}

export class Folder {
  /** @private @property @type {Map<string, File|Folder>} */
  #members = new Map();

  /** @public @method @param {string} name @param {File|Folder} member @returns {Folder} */
  add(name, member) { this.#members.set(name, member); return this; }

  /** @public @async @method @param {string} file @returns {Promise<void>} */
  async [Zip.write_to_intermittent_directory_as](file) {
    try { await fs.mkdir(file); } catch { }
    
    const tasks = new TaskSet();

    for (const [name, member] of this.#members) {
      tasks.add(new Task(async () => {
        await member[Zip.write_to_intermittent_directory_as](path.join(file, name));
      }));
    }

    await tasks.wait();
  }
}

