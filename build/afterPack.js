const { execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`;
  const target = existsSync(appPath) ? appPath : context.appOutDir;

  console.log(`Clearing macOS extended metadata from ${target}`);
  execFileSync("find", [target, "-name", "._*", "-delete"], { stdio: "inherit" });
  execFileSync("find", [target, "-name", ".DS_Store", "-delete"], { stdio: "inherit" });
  execFileSync("dot_clean", ["-m", target], { stdio: "inherit" });
  execFileSync("xattr", ["-cr", target], { stdio: "inherit" });
  execFileSync("find", [target, "-exec", "xattr", "-c", "{}", ";"], { stdio: "inherit" });
};
