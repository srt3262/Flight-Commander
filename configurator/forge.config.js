import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { cleanViteOutput } from "./scripts/clean-vite-output.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nativePrebuildTargetByPlatform = {
  win32: {
    x64: "win32-x64",
    ia32: "win32-ia32",
    arm64: "win32-arm64",
  },
  darwin: {
    x64: "darwin-x64+arm64",
    arm64: "darwin-x64+arm64",
    universal: "darwin-x64+arm64",
  },
  linux: {
    x64: "linux-x64",
    arm64: "linux-arm64",
    armv7l: "linux-arm",
  },
};

function pruneNativePrebuilds(packageDirectory, platform, arch) {
  const expectedTarget = nativePrebuildTargetByPlatform[platform]?.[arch];
  if (!expectedTarget) {
    console.log(
      `postPackage: No native-prebuild pruning rule for ${platform}-${arch}`,
    );
    return;
  }

  const prebuildsDirectory = path.join(
    packageDirectory,
    "resources",
    "app",
    ".vite",
    "build",
    "node_natives",
    "node_modules",
    "@serialport",
    "bindings-cpp",
    "prebuilds",
  );
  if (!fs.existsSync(prebuildsDirectory)) {
    console.log(
      `postPackage: Serial native prebuilds not found, skipping: ${prebuildsDirectory}`,
    );
    return;
  }

  const targets = fs
    .readdirSync(prebuildsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory());
  if (!targets.some((entry) => entry.name === expectedTarget)) {
    throw new Error(
      `postPackage: Required native prebuild ${expectedTarget} is missing`,
    );
  }

  for (const target of targets) {
    if (target.name !== expectedTarget) {
      fs.rmSync(path.join(prebuildsDirectory, target.name), {
        recursive: true,
        force: true,
      });
    }
  }
  console.log(
    `postPackage: Kept only ${expectedTarget} serial native prebuilds`,
  );
}

const excludedPackagerPaths = [
  /^\/resources\/firmware(?:-source)?(?:\/|$)/,
  /^\/release\/firmware(?:\/|$)/,
  /^\/release-candidate(?:\/|$)/,
];

function ignoreUnbuiltPackagerSource(file) {
  if (!file) {
    return false;
  }

  // Keep the explicit firmware exclusions as a defense in depth, then mirror
  // the Vite plugin's compiled-output-only filter. Electron Packager writes
  // the sanitized package.json separately.
  if (excludedPackagerPaths.some((pattern) => pattern.test(file))) {
    return true;
  }
  return !file.startsWith("/.vite");
}

export default {
  packagerConfig: {
    executableName: "flight-commander",
    overwrite: true,
    asar: false,
    icon: "images/flight-commander",
    // CI normally lets Electron Packager download the official runtime. A
    // verified local archive can be supplied for offline/reproducible builds.
    electronZipDir: process.env.FLIGHT_COMMANDER_ELECTRON_ZIP_DIR || undefined,
    appCopyright: "Copyright © 2026 Flight Commander contributors",
    ignore: ignoreUnbuiltPackagerSource,
    extraResource: [
      "resources/public/sitl",
      "assets/linux/45-inav.rules",
    ],
  },
  rebuildConfig: {
    // Native modules (serialport, usb) ship with prebuilt binaries for each platform.
    // vite-plugin-native handles them at build time. Skip electron-rebuild to avoid
    // requiring Visual Studio Build Tools on Windows during development.
    onlyModules: [],
  },
  plugins: [
    {
      name: "@electron-forge/plugin-vite",
      config: {
        build: [
          {
            entry: "js/main/main.js",
            config: "vite.main.config.js",
          },
          {
            entry: "js/main/preload.js",
            config: "vite.preload.config.js",
          },
          {
            entry:
              "js/libraries/bluetooth-device-chooser/bt-device-chooser-preload.js",
            config: "vite.preload.config.js",
          },
        ],
        renderer: [
          {
            name: "bt_device_chooser",
            config: "vite.bt-dc-renderer.config.js",
          },
          {
            name: "main_window",
            config: "vite.main-renderer.config.js",
          },
        ],
      },
    },
  ],
  hooks: {
    // The Vite plugin emits three main/preload targets into one directory and
    // therefore cannot let each individual build empty that shared directory.
    // Clean both Vite output roots once at the start of a package operation so
    // an obsolete hashed renderer chunk can never survive into a release.
    prePackage: async () => cleanViteOutput(__dirname),
    // Remove SITL binaries for other platforms/architectures to reduce package size
    postPackage: async (forgeConfig, options) => {
      for (const outputPath of options.outputPaths) {
        pruneNativePrebuilds(outputPath, options.platform, options.arch);

        let sitlPath;

        if (options.platform === "darwin") {
          // macOS app bundle structure: <outputDir>/<AppName>.app/Contents/Resources/sitl
          // Find the .app directory
          const appBundles = fs
            .readdirSync(outputPath)
            .filter((f) => f.endsWith(".app"));
          if (appBundles.length === 0) {
            console.log(`postPackage: No .app bundle found in ${outputPath}`);
            continue;
          }
          sitlPath = path.join(
            outputPath,
            appBundles[0],
            "Contents",
            "Resources",
            "sitl",
          );
        } else {
          // Windows/Linux: <outputPath>/resources/sitl
          sitlPath = path.join(outputPath, "resources", "sitl");
        }

        console.log(
          `postPackage: Checking SITL path for ${options.platform}: ${sitlPath}`,
        );
        if (!fs.existsSync(sitlPath)) {
          console.log(
            `postPackage: SITL path not found, skipping: ${sitlPath}`,
          );
          continue;
        }

        if (options.platform === "win32") {
          console.log(
            "postPackage: Removing non-Windows SITL binaries (linux, macos)",
          );
          fs.rmSync(path.join(sitlPath, "linux"), {
            recursive: true,
            force: true,
          });
          fs.rmSync(path.join(sitlPath, "macos"), {
            recursive: true,
            force: true,
          });
        } else if (options.platform === "darwin") {
          console.log(
            "postPackage: Removing non-macOS SITL binaries (linux, windows)",
          );
          fs.rmSync(path.join(sitlPath, "linux"), {
            recursive: true,
            force: true,
          });
          fs.rmSync(path.join(sitlPath, "windows"), {
            recursive: true,
            force: true,
          });
        } else if (options.platform === "linux") {
          console.log(
            "postPackage: Removing non-Linux SITL binaries (macos, windows)",
          );
          fs.rmSync(path.join(sitlPath, "macos"), {
            recursive: true,
            force: true,
          });
          fs.rmSync(path.join(sitlPath, "windows"), {
            recursive: true,
            force: true,
          });
          // Remove wrong architecture
          if (options.arch === "x64") {
            fs.rmSync(path.join(sitlPath, "linux", "arm64"), {
              recursive: true,
              force: true,
            });
          } else if (options.arch === "arm64") {
            // Move arm64 binary to linux root and remove x64
            const arm64Binary = path.join(
              sitlPath,
              "linux",
              "arm64",
              "inav_SITL",
            );
            const destBinary = path.join(sitlPath, "linux", "inav_SITL");
            if (fs.existsSync(arm64Binary)) {
              fs.rmSync(destBinary, { force: true });
              fs.renameSync(arm64Binary, destBinary);
              fs.rmSync(path.join(sitlPath, "linux", "arm64"), {
                recursive: true,
                force: true,
              });
            }
          }
        }
      }
    },
    // Uniform artifact file names
    postMake: async (config, makeResults) => {
      makeResults.forEach((result) => {
        var baseName = `${result.packageJSON.productName.replace(" ", "-")}_${result.platform}_${result.arch}_${result.packageJSON.version}`;
        result.artifacts.forEach((artifact) => {
          var artifactStr = artifact.toString();
          var newPath = path.join(
            path.dirname(artifactStr),
            baseName + path.extname(artifactStr),
          );
          newPath = newPath.replace(
            "Configurator_win32_ia32",
            "Configurator_Win32",
          );
          newPath = newPath.replace(
            "Configurator_win32_x64",
            "Configurator_Win64",
          );
          newPath = newPath.replace(
            "Configurator_darwin",
            "Configurator_MacOS",
          );
          fs.renameSync(artifactStr, newPath);
          console.log("Artifact: " + newPath);
        });
      });
    },
  },
  makers: [
    {
      name: "@electron-forge/maker-wix",
      config: {
        name: "Flight Commander",
        shortName: "FlightCommander",
        exe: "flight-commander",
        description:
          "Flight Commander configurator, mission planner, firmware flasher, and ground control station.",
        programFilesFolderName: "flight-commander",
        shortcutFolderName: "Flight Commander",
        manufacturer: "Flight Commander contributors",
        appUserModelId: "com.flightcommander.app",
        icon: path.join(__dirname, "./images/flight-commander.ico"),
        upgradeCode: "d4772148-2334-4896-bc1a-ff9a9569d811",
        ui: {
          enabled: false,
          chooseDirectory: true,
          images: {
            background: path.join(__dirname, "./assets/windows/background.jpg"),
            banner: path.join(__dirname, "./assets/windows/banner.jpg"),
          },
        },
        // Standard WiX template appends the unsightly "(Machine - WSI)" to the name, so use our own template
        beforeCreate: (msiCreator) => {
          return new Promise((resolve, reject) => {
            fs.readFile(
              path.join(__dirname, "./assets/windows/wix.xml"),
              "utf8",
              (err, content) => {
                if (err) {
                  reject(err);
                }
                msiCreator.wixTemplate = content;
                resolve();
              },
            );
          });
        },
      },
    },
    {
      name: "@electron-forge/maker-dmg",
      config: {
        name: "Flight Commander",
        title: "Flight-Commander", // Volume name without spaces to avoid hdiutil detach issues
        background: "./assets/osx/dmg-background.png",
        icon: "./images/flight-commander.icns",
      },
    },
    {
      name: "@electron-forge/maker-zip",
      platforms: ["win32", "linux", "darwin"],
    },
    {
      name: "@electron-forge/maker-deb",
      config: {
        options: {
          name: "flight-commander",
          productName: "Flight Commander",
          categories: ["Utility"],
          icon: "./images/flight_commander_128.png",
          description:
            "Flight Commander configurator, mission planner, firmware flasher, and ground control station.",
          homepage: "https://github.com/srt3262/Flight-Commander",
          scripts: {
            postinst: "./assets/linux/postinst",
            postrm: "./assets/linux/postrm",
          },
        },
      },
    },
    {
      name: "@electron-forge/maker-rpm",
      config: {
        options: {
          name: "flight-commander",
          productName: "Flight Commander",
          license: "GPL-3.0",
          categories: ["Utility"],
          icon: "./images/flight_commander_128.png",
          description:
            "Flight Commander configurator, mission planner, firmware flasher, and ground control station.",
          homepage: "https://github.com/srt3262/Flight-Commander",
          scripts: {
            post: "./assets/linux/postinst",
            postun: "./assets/linux/postrm",
          },
        },
      },
    },
  ],
};
