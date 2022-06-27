const fs = require('fs');
const download = require('download');
const decompress = require('decompress')
const fc = require('filecopy');
const config = require('./config').default;

async function downloadTo(url, path) {
    return new Promise((r, e) => {
        const d = download(url);
        d.then(r).catch(err => e(err));
        d.pipe(fs.createWriteStream(path));
    });
}

async function downloadDepends() {
    await Promise.all([        
        downloadTo(`${config.blueprintDebuggerUrl}/${config.blueprintDebuggerVersion}/linux-x64.zip`, 'temp/linux-x64.zip'),
        downloadTo(`${config.blueprintDebuggerUrl}/${config.blueprintDebuggerVersion}/darwin-arm64.zip`, 'temp/darwin-arm64.zip'),
        downloadTo(`${config.blueprintDebuggerUrl}/${config.blueprintDebuggerVersion}/darwin-x64.zip`, 'temp/darwin-x64.zip'),
        downloadTo(`${config.blueprintDebuggerUrl}/${config.blueprintDebuggerVersion}/win32-x86.zip`, 'temp/win32-x86.zip'),
        downloadTo(`${config.blueprintDebuggerUrl}/${config.blueprintDebuggerVersion}/win32-x64.zip`, 'temp/win32-x64.zip'),
        downloadTo(`${config.lanServerUrl}/${config.lanServerVersion}/blueprintLua-LS-all.jar`, 'temp/blueprintLua-LS-all.jar'),
    ]);
}

async function build() {
    if (!fs.existsSync('temp')) {
        fs.mkdirSync('temp')
    }
    
   await downloadDepends();

    // linux
    await decompress('temp/linux-x64.zip', 'debugger/blueprint/linux/');
    // mac
    await decompress('temp/darwin-x64.zip', 'debugger/blueprint/mac/x64/');
    await decompress('temp/darwin-arm64.zip', 'debugger/blueprint/mac/arm64/');
    // win
    await decompress('temp/win32-x86.zip', 'debugger/blueprint/windows/x86/');
    await decompress('temp/win32-x64.zip', 'debugger/blueprint/windows/x64/');

    // ls
    await fc('temp/blueprintLua-LS-all.jar', 'server/blueprintLua-LS-all.jar', { mkdirp: true });
}

build().catch(console.error);
