import * as vscode from 'vscode';
import { blueprintLaunchDebugConfiguration } from "./types";
import { DebuggerProvider } from "./DebuggerProvider";

export class blueprintLaunchDebuggerProvider extends DebuggerProvider {
    async resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, configuration: blueprintLaunchDebugConfiguration, token?: vscode.CancellationToken): Promise<vscode.DebugConfiguration> {
        configuration.extensionPath = this.context.extensionPath;
        configuration.sourcePaths = this.getSourceRoots();
        configuration.ext = this.getExt();
        return configuration;
    }
}
