import * as net from "net";
import * as cp from "child_process";
import * as process from "process";
import * as proto from "./blueprintDebugProto";
import { blueprintDebugSession } from "./blueprintDebugSession";
import { OutputEvent } from "vscode-debugadapter";
import { DebugProtocol } from "vscode-debugprotocol";

interface blueprintLaunchDebugArguments extends DebugProtocol.LaunchRequestArguments {
    extensionPath: string;
    sourcePaths: string[];
    program?: string;
    arguments?: string[];
    workingDir?: string;
    blockOnExit?: boolean;
    useWindowsTerminal?: boolean;
    ext: string[];
}

enum WinArch {
    X86, X64
}

export class blueprintLaunchDebugSession extends blueprintDebugSession {

    private program: string = "";
    private workingDir: string = "";
    private arguments: string[] = [];
    private blockOnExit: boolean = true;
    private debugClient?: net.Socket;
    private pid = 0;


    private getPort(pid: number): number {
        let port = pid;
        while (port > 0xffff) { port -= 0xffff; }
        while (port < 0x400) { port += 0x400; }
        return port;
    }

    protected async launchRequest(response: DebugProtocol.LaunchResponse, args: blueprintLaunchDebugArguments): Promise<void> {
        this.extensionPath = args.extensionPath;
        this.ext = args.ext;

        this.program = args.program ?? "";
        this.workingDir = args.workingDir ?? ""
        this.arguments = args.arguments ?? []
        this.blockOnExit = args.blockOnExit ?? true;


        if (args.useWindowsTerminal) {
            this.pid = await this.runAndAttachUseWindowsTerminal();
        }
        else {
            this.pid = await this.runAndAttachUseCmd();
        }
        const client = net.connect(this.getPort(this.pid), 'localhost')
            .on('connect', () => {

                this.sendResponse(response);
                this.onConnect(client);
                this.readClient(client);
                this.sendMessage({ cmd: proto.MessageCMD.StartHookReq });
                //TODO ????????????????????????hook api??????,????????????????????????
                setTimeout(() => {
                    this.debugClient?.write("connected\n");
                }, 300);
            })
            .on('error', err => {
                response.success = false;
                response.message = `${err}`;
                this.sendResponse(response);
            });
        this.client = client;
    }

    private async detectArch(): Promise<WinArch> {
        const cwd = `${this.extensionPath}/debugger/blueprint/windows/x86`;
        const args = [
            'blueprint_tool.exe',
            'arch_file',
            `${this.program}`
        ];
        return new Promise<WinArch>((r, c) => {
            cp.exec(args.join(" "), { cwd: cwd })
                .on('close', (code) => {
                    r(code === 0 ? WinArch.X64 : WinArch.X86);
                })
                .on('error', c);
        });
    }

    private async runAndAttachUseWindowsTerminal(): Promise<number> {
        const selfPid = process.pid;
        const port = this.getPort(selfPid);

        const arch = await this.detectArch();
        const archName = arch === WinArch.X64 ? 'x64' : 'x86';
        const cwd = `${this.extensionPath}/debugger/blueprint/windows/${archName}`;
        const mc = this.program.match(/[^/\\]+$/);
        const args = [
            "--title",
            `${mc ? mc[0] : this.program}`,
            "blueprint_tool.exe",
            "run_and_attach",
            "-dll",
            "blueprint_hook.dll",
            "-dir",
            `"${cwd}"`,
            "-work",
            `"${this.workingDir}"`,
            `${this.blockOnExit ? "-block-on-exit" : ""}`,
            "-exe",
            `"${this.program}"`,
            "-debug-port",
            `${port}`,
            "-args",
        ];

        args.push(...(<string[]>this.arguments));
        return new Promise((r, c) => {
            // this.sendEvent(new OutputEvent(`run attach`))
            net.createServer(client => {
                this.debugClient = client.on("data", (buffer) => {
                    r(Number(buffer.toString()));
                }).on("close", () => {
                    console.log("close");
                }).on("error", (e) => {
                    console.log(e);
                });
            }).listen(port, "localhost");

            cp.spawn(`wt`, args, {
                cwd: cwd
            });
        });
    }

    private async runAndAttachUseCmd(): Promise<number> {
        const selfPid = process.pid;
        const port = this.getPort(selfPid);


        const arch = await this.detectArch();
        const archName = arch === WinArch.X64 ? 'x64' : 'x86';
        const cwd = `${this.extensionPath}/debugger/blueprint/windows/${archName}`;
        const args = [
            "run_and_attach",
            "-create-new-window",
            "-dll",
            "blueprint_hook.dll",
            "-dir",
            `"${cwd}"`,
            "-work",
            `"${this.workingDir}"`,
            `${this.blockOnExit ? "-block-on-exit" : ""}`,
            "-exe",
            `"${this.program}"`,
            "-debug-port",
            `${port}`,
            "-args",
        ];

        args.push(...(<string[]>this.arguments));
        return new Promise((r, c) => {
            // this.sendEvent(new OutputEvent(`run attach`))
            net.createServer(client => {
                this.debugClient = client.on("data", (buffer) => {
                    r(Number(buffer.toString()));
                }).on("close", () => {
                    console.log("close");
                }).on("error", (e) => {
                    console.log(e);
                });
            }).listen(port, "localhost");

            cp.spawn(`blueprint_tool.exe`, args, {
                cwd: cwd,
                windowsHide: false
            });
        });
    }

    protected handleDebugMessage(cmd: proto.MessageCMD, msg: any) {
        switch (cmd) {
            case proto.MessageCMD.AttachedNotify:
                const n: number = msg.state;
                this.sendEvent(new OutputEvent(`Attached to lua state 0x${n.toString(16)}\n`));
                break;
            case proto.MessageCMD.LogNotify:
                this.sendEvent(new OutputEvent(`${msg.message}\n`));
                break;
        }
        super.handleDebugMessage(cmd, msg);
    }

    protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments) {
        super.disconnectRequest(response, args);
        if (args.terminateDebuggee) {
            this.debugClient?.write("close");
        }
    }

    protected onSocketClose() {
        if (this.client) {
            this.client.removeAllListeners();
        }
        this.sendEvent(new OutputEvent('Disconnected.\n'));
    }

}
