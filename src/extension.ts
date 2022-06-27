'use strict';

import * as vscode from 'vscode';
import * as path from "path";
import * as net from "net";
import * as process from "process";
import * as Annotator from "./annotator";
import * as notifications from "./notifications";
import * as cp from "child_process";
import findJava from "./findJava";
import { LanguageClient, LanguageClientOptions, ServerOptions, StreamInfo } from "vscode-languageclient/node";
import { LuaLanguageConfiguration } from './languageConfiguration';
import { blueprintDebuggerProvider } from './debugger/blueprintDebuggerProvider';
import { blueprintConfigWatcher, IblueprintConfigUpdate } from './blueprintConfigWatcher';
import { blueprintAttachDebuggerProvider } from './debugger/blueprintAttachDebuggerProvider';
import { blueprintLaunchDebuggerProvider } from './debugger/blueprintLaunchDebuggerProvider';

const LANGUAGE_ID = 'lua'; //blueprintLua
var DEBUG_MODE = true;

export let savedContext: vscode.ExtensionContext;
let client: LanguageClient;
let activeEditor: vscode.TextEditor;
let progressBar: vscode.StatusBarItem;
let javaExecutablePath: string | null;
let configWatcher: blueprintConfigWatcher;

export function activate(context: vscode.ExtensionContext) {
    console.log("blueprint lua actived!");
    DEBUG_MODE = process.env['blueprint_DEV'] === "true";
    savedContext = context;
    progressBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    javaExecutablePath = findJava();

    savedContext.subscriptions.push(vscode.workspace.onDidChangeConfiguration(onDidChangeConfiguration, null, savedContext.subscriptions));
    savedContext.subscriptions.push(vscode.workspace.onDidChangeTextDocument(onDidChangeTextDocument, null, savedContext.subscriptions));
    savedContext.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(onDidChangeActiveTextEditor, null, savedContext.subscriptions));
    savedContext.subscriptions.push(vscode.commands.registerCommand("blueprint.restartServer", restartServer));
    savedContext.subscriptions.push(vscode.commands.registerCommand("blueprint.showReferences", showReferences));
    savedContext.subscriptions.push(vscode.commands.registerCommand("blueprint.insertblueprintDebugCode", insertblueprintDebugCode));
    savedContext.subscriptions.push(vscode.languages.setLanguageConfiguration("lua", new LuaLanguageConfiguration()));

    configWatcher = new blueprintConfigWatcher();
    configWatcher.onConfigUpdate(onConfigUpdate);
    savedContext.subscriptions.push(configWatcher);

    startServer();
    registerDebuggers();
}

function registerDebuggers() {
    const blueprintProvider = new blueprintDebuggerProvider('lua_new', savedContext);
    savedContext.subscriptions.push(vscode.debug.registerDebugConfigurationProvider("lua_new", blueprintProvider));
    savedContext.subscriptions.push(blueprintProvider);
    const blueprintAttachProvider = new blueprintAttachDebuggerProvider('lua_attach', savedContext);
    savedContext.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('lua_attach', blueprintAttachProvider));
    savedContext.subscriptions.push(blueprintAttachProvider);
    const blueprintLaunchProvider = new blueprintLaunchDebuggerProvider('lua_launch', savedContext);
    savedContext.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('lua_launch', blueprintLaunchProvider));
    savedContext.subscriptions.push(blueprintLaunchProvider);

    savedContext.subscriptions.push(vscode.languages.registerInlineValuesProvider('lua', {
        // 不知道是否应该发到ls上再做处理
        // 先简单处理一下吧
        provideInlineValues(document: vscode.TextDocument, viewport: vscode.Range, context: vscode.InlineValueContext): vscode.ProviderResult<vscode.InlineValue[]> {

            const allValues: vscode.InlineValue[] = [];
            const regExps = [
                /(?<=local\s+)[^\s,\<]+/,
                /(?<=---@param\s+)\S+/
            ]

            for (let l = viewport.start.line; l <= context.stoppedLocation.end.line; l++) {
                const line = document.lineAt(l);

                for (const regExp of regExps) {
                    const match = regExp.exec(line.text);
                    if (match) {
                        const varName = match[0];
                        const varRange = new vscode.Range(l, match.index, l, match.index + varName.length);
                        // value found via variable lookup
                        allValues.push(new vscode.InlineValueVariableLookup(varRange, varName, false));
                        break;
                    }
                }

            }

            return allValues;
        }
    }));
}

function onDidChangeTextDocument(event: vscode.TextDocumentChangeEvent) {
    if (activeEditor && activeEditor.document === event.document && activeEditor.document.languageId === LANGUAGE_ID) {
        Annotator.requestAnnotators(activeEditor, client);
    }
}

function onDidChangeActiveTextEditor(editor: vscode.TextEditor | undefined) {
    if (editor && editor.document.languageId === LANGUAGE_ID) {
        activeEditor = editor as vscode.TextEditor;
        Annotator.requestAnnotators(activeEditor, client);
    }
}

export function deactivate() {
    stopServer();
}

function onDidChangeConfiguration(event: vscode.ConfigurationChangeEvent) {
    let shouldRestart = false;
    let newJavaExecutablePath = findJava();
    if (newJavaExecutablePath !== javaExecutablePath) {
        javaExecutablePath = newJavaExecutablePath;
        shouldRestart = true;
    }

    Annotator.onDidChangeConfiguration(client);

    if (shouldRestart) {
        restartServer();
    }
}

async function validateJava(): Promise<void> {
    const exePath = javaExecutablePath || "java";
    console.log('exe path : ' + exePath);
    return new Promise<void>((resolve, reject) => {
        cp.exec(`"${exePath}" -version`, (e, stdout, stderr) => {
            let regexp: RegExp = /(?:java|openjdk) version "((\d+)(\.(\d+).+?)?)"/g;
            if (stderr) {
                let match = regexp.exec(stderr);
                if (match) {
                    let major = parseInt(match[2]) || 0;
                    let minor = parseInt(match[4]) || 0;
                    // java 1.8+
                    if (major > 1 || (major === 1 && minor >= 8)) {
                        resolve();
                        return;
                    }
                    reject(`Unsupported Java version: ${match[1]}, please install Java 1.8 or above.`);
                    return;
                }
            }
            reject("Can't find Java! Please install Java 1.8 or above and set JAVA_HOME environment variable.");
        });
    });
}

async function startServer() {
    try {
        if (!DEBUG_MODE) {
            await validateJava();
        }
    } catch (error) {
        vscode.window.showErrorMessage(error as string, "Try again")
            .then(startServer);
        return;
    }
    doStartServer().then(() => {
        onDidChangeActiveTextEditor(vscode.window.activeTextEditor);
    })
        .catch(reson => {
            vscode.window.showErrorMessage(`Failed to start "skynet-blueprit.Lua" language server!\n${reson}`, "Try again")
                .then(startServer);
        });
}

async function doStartServer() {
    const configFiles = await configWatcher.watch();
    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: 'file', language: LANGUAGE_ID }],
        synchronize: {
            configurationSection: ["lua", "files.associations"],
            fileEvents: [
                vscode.workspace.createFileSystemWatcher("**/*.lua")
            ]
        },
        initializationOptions: {
            stdFolder: vscode.Uri.file(path.resolve(savedContext.extensionPath, "res/std")).toString(),
            apiFolders: [],
            workspaceFolders: vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders.map(f => f.uri.toString()) : null,
            client: 'vsc',
            configFiles: configFiles
        }
    };

    let serverOptions: ServerOptions;
    if (DEBUG_MODE) {
        // The server is a started as a separate app and listens on port 5007
        const connectionInfo = {
            port: 5007
        };
        serverOptions = () => {
            // Connect to language server via socket
            let socket = net.connect(connectionInfo);
            let result: StreamInfo = {
                writer: socket,
                reader: socket as NodeJS.ReadableStream
            };
            socket.on("close", () => {
                console.log("client connect error!");
            });
            return Promise.resolve(result);
        };
    } else {
        const cp = path.resolve(savedContext.extensionPath, "server", "*");
        const exePath = javaExecutablePath || "java";
        serverOptions = {
            command: exePath,
            args: ["-cp", cp, "com.tang.vscode.MainKt", "-XX:+UseG1GC", "-XX:+UseStringDeduplication"]
        };
    }

    client = new LanguageClient(LANGUAGE_ID, "Lua plugin for vscode.", serverOptions, clientOptions);
    client.start().then(() => {
        console.log("client ready");
        client.onNotification("blueprint/progressReport", (d: notifications.IProgressReport) => {
            progressBar.show();
            progressBar.text = d.text;
            if (d.percent >= 1) {
                setTimeout(() => {
                    progressBar.hide();
                }, 3000);
            }
        });
    })
}

function restartServer() {
    if (!client) {
        startServer();
    } else {
        client.stop().then(startServer);
    }
}

function showReferences(uri: string, pos: vscode.Position) {
    const u = vscode.Uri.parse(uri);
    const p = new vscode.Position(pos.line, pos.character);
    vscode.commands.executeCommand("vscode.executeReferenceProvider", u, p).then(locations => {
        vscode.commands.executeCommand("editor.action.showReferences", u, p, locations);
    });
}

function stopServer() {
    if (client) {
        client.stop();
    }
}

function onConfigUpdate(e: IblueprintConfigUpdate) {
    if (client) {
        client.sendRequest('blueprint/updateConfig', e);
    }
}

async function insertblueprintDebugCode() {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
        return;
    }
    const document = activeEditor.document;
    if (document.languageId !== 'lua') {
        return;
    }

    let dllPath = '';
    const isWindows = process.platform === 'win32';
    const isMac = process.platform === 'darwin';
    const isLinux = process.platform === 'linux';
    if (isWindows) {
        const arch = await vscode.window.showQuickPick(['x64', 'x86']);
        if (!arch) {
            return;
        }
        dllPath = path.join(savedContext.extensionPath, `debugger/blueprint/windows/${arch}/?.dll`);
    }
    else if (isMac) {
        const arch = await vscode.window.showQuickPick(['x64', 'arm64']);
        if (!arch) {
            return;
        }
        dllPath = path.join(savedContext.extensionPath, `debugger/blueprint/mac/${arch}/blueprint_core.dylib`);
    }
    else if (isLinux) {
        dllPath = path.join(savedContext.extensionPath, `debugger/blueprint/linux/blueprint_core.so`);
    }

    const host = 'localhost';
    const port = 9966;
    const ins = new vscode.SnippetString();
    ins.appendText(`package.cpath = package.cpath .. ";${dllPath.replace(/\\/g, '/')}"\n`);
    ins.appendText(`local dbg = require("blueprint_core")\n`);
    ins.appendText(`dbg.tcpListen("${host}", ${port})`);
    activeEditor.insertSnippet(ins);
}
