const { withDangerousMod, IOSConfig } = require("expo/config-plugins");
const fs = require("node:fs/promises");

// react-native-wgpu 0.4.2 rejects Metal's validation wrapper on Simulator.
// Xcode's counterintuitive value "1" disables validation (unset enables it).
// Only change Debug Run actions; Archive/Profile and GPU error scopes stay intact.
module.exports = function withIosWebGPU(config) {
  return withDangerousMod(config, ["ios", async (mod) => {
    const schemes = IOSConfig.Paths.findSchemePaths(mod.modRequest.projectRoot);
    let matched = false;
    for (const scheme of schemes) {
      const original = await fs.readFile(scheme, "utf8");
      const updated = original.replace(/<LaunchAction\b[^>]*>/g, (action) => {
        if (!/buildConfiguration\s*=\s*"Debug"/.test(action)) return action;
        matched = true;
        const attribute = /enableGPUValidationMode\s*=\s*"[^"]*"/;
        return attribute.test(action)
          ? action.replace(attribute, 'enableGPUValidationMode = "1"')
          : action.replace(/>$/, '\n      enableGPUValidationMode = "1">');
      });
      if (updated !== original) await fs.writeFile(scheme, updated);
    }
    if (!matched) throw new Error("WebGPU: no shared Debug Run scheme found in the generated iOS project.");
    return mod;
  }]);
};
