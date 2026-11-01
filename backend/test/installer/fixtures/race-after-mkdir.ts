// TEST ONLY preload (never imported by product code): simulates a race in which a path is swapped
// for a symlink right after the helper's mkdir. Configured through a JSON variable; inert when unset.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

interface Race {
  trigger: string;
  swap: string;
  target: string;
}

const raw = process.env["KILO_TEST_RACE"];
if (raw) {
  const race = JSON.parse(raw) as Race;
  const realMkdir = fs.mkdirSync;
  let fired = false;
  fs.mkdirSync = ((path: fs.PathLike, options?: fs.MakeDirectoryOptions) => {
    const result = realMkdir(path, options as fs.MakeDirectoryOptions);
    if (!fired && String(path) === race.trigger) {
      fired = true;
      if (fs.existsSync(race.swap)) fs.renameSync(race.swap, `${race.swap}.orig`);
      fs.symlinkSync(race.target, race.swap);
    }
    return result;
  }) as typeof fs.mkdirSync;
  syncBuiltinESMExports();
}
