import { DebugConfiguration } from 'vscode';

interface DebugConfigurationBase extends DebugConfiguration {
    extensionPath: string;
    sourcePaths: string[];
    ext: string[];
}

export interface blueprintAttachDebugConfiguration extends DebugConfigurationBase {
    pid: number;
    processName: string;
}

export interface blueprintDebugConfiguration extends DebugConfigurationBase {
    host: string;
    port: number;
    ideConnectDebugger: boolean;
}

export interface blueprintLaunchDebugConfiguration extends DebugConfigurationBase {
    program: string;
    arguments: string[];
    workingDir: string;
    blockOnExit: boolean;
    useWindowsTerminal: boolean;
}
