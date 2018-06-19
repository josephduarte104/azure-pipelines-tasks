import * as tl from 'vsts-task-lib/task';
import * as toolLib from 'vsts-task-tool-lib/tool';
import * as trm from 'vsts-task-lib/toolrunner';
import { DotNetCoreReleaseFetcher } from "./releasesfetcher";
import * as utilities from "./utilities";

import * as os from 'os';
import * as path from 'path';

class DotnetCoreInstaller {
    constructor(packageType, version) {
        this.packageType = packageType;
        if (!toolLib.isExplicitVersion(version)) {
            throw tl.loc("ImplicitVersionNotSupported", version);
        }
        this.version = version;
        this.cachedToolName = this.packageType === 'runtime' ? 'dncr' : 'dncs';;
    }

    public async install() {
        // Check cache
        let toolPath: string;
        toolPath = this.getLocalTool();

        if (!toolPath) {
            // download, extract, cache
            console.log(tl.loc("InstallingAfresh"));
            let osSuffixes = this.detectMachineOS();
            console.log(tl.loc("GettingDownloadUrl", this.packageType, this.version));
            console.log("DotNetCoreReleaseFetcher ", JSON.stringify(DotNetCoreReleaseFetcher));
            let downloadUrls = await DotNetCoreReleaseFetcher.getDownloadUrls(osSuffixes, this.version, this.packageType);
            toolPath = await this.downloadAndInstall(downloadUrls);
        } else {
            console.log(tl.loc("UsingCachedTool", toolPath));
        }

        // Prepend the tools path. instructs the agent to prepend for future tasks
        toolLib.prependPath(toolPath);

        // Set DOTNET_ROOT for dotnet core Apphost to find runtime since it is installed to a non well-known location.
        tl.setVariable('DOTNET_ROOT', toolPath);
    }

    private getLocalTool(): string {
        console.log(tl.loc("CheckingToolCache"));
        return toolLib.findLocalTool(this.cachedToolName, this.version);
    }

    private detectMachineOS(): string[] {
        let osSuffix = [];

        if (tl.osType().match(/^Win/)) {
            let primary = "win-" + os.arch();
            osSuffix.push(primary);
            console.log(tl.loc("PrimaryPlatform", primary));
        }
        else {
            let scriptPath = path.join(utilities.getCurrentDir(), 'externals', 'get-os-distro.sh');
            utilities.setFileAttribute(scriptPath, "777");

            let scriptRunner: trm.ToolRunner = tl.tool(tl.which(scriptPath, true));
            let result: trm.IExecSyncResult = scriptRunner.execSync();

            if (result.code != 0) {
                throw tl.loc("getMachinePlatformFailed", result.error ? result.error.message : result.stderr);
            }

            let output: string = result.stdout;

            let index;
            if (index = output.indexOf("Primary:")) {
                let primary = output.substr(index).split(os.EOL)[0];
                osSuffix.push(primary);
                console.log(tl.loc("PrimaryPlatform", primary));
            }

            if (index = output.indexOf("Legacy:")) {
                let legacy = output.substr(index).split(os.EOL)[0];
                osSuffix.push(legacy);
                console.log(tl.loc("PrimaryPlatform", legacy));
            }

            if (osSuffix.length == 0) {
                throw tl.loc("CouldNotDetectPlatform");
            }
        }

        return osSuffix;
    }

    private async downloadAndInstall(downloadUrls: string[]) {
        let downloaded = false;
        let downloadPath = "";
        for (var i = 0; i < downloadUrls.length; i++) {
            if (downloaded) {
                break;
            }

            try {
                downloadPath = await toolLib.downloadTool(downloadUrls[i]);
                downloaded = true;
            } catch (error) {
                tl.warning(tl.loc("CouldNotDownload", downloadUrls[i], JSON.stringify(error)));
            }
        }

        if (!downloaded) {
            throw tl.loc("FailedToDownloadPackage");
        }

        // extract
        console.log(tl.loc("ExtractingPackage", downloadPath));
        let extPath: string = downloadPath.endsWith(".zip") ? await toolLib.extractZip(downloadPath) : await toolLib.extractTar(downloadPath);

        // cache tool
        console.log(tl.loc("CachingTool"));
        let cachedDir = await toolLib.cacheDir(extPath, this.cachedToolName, this.version);
        console.log(tl.loc("SuccessfullyInstalled", this.packageType, this.version));
        return cachedDir;

    }

    private packageType: string;
    private version: string;
    private cachedToolName: string;
}

async function run() {
    let packageType = tl.getInput('packageType', true);
    let version = tl.getInput('version', true).trim();
    console.log(tl.loc("ToolToInstall", packageType, version));
    await new DotnetCoreInstaller(packageType, version).install();
}

var taskManifestPath = path.join(__dirname, "task.json");
tl.debug("Setting resource path to " + taskManifestPath);
tl.setResourcePath(taskManifestPath);

run()
    .then(() => tl.setResult(tl.TaskResult.Succeeded, ""))
    .catch((error) => tl.setResult(tl.TaskResult.Failed, !!error.message ? error.message : error));