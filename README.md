## 在service_snlua.c 中增加此函数

```c
void addLuaState(struct snlua *l)
{
	const char *debug_ip = skynet_getenv("debug_ip");
	if (NULL == debug_ip)
	{
		return;
	}

	const char *debug_port = skynet_getenv("debug_port");
	if (NULL == debug_port)
	{
		return;
	}

	int port = strtol(debug_port, NULL, 10);
	const char *lua_dofunction = "function snlua_addLuaState()\n"
								 "local dbg = require('blueprint_core')\n"
								 "dbg.startDebugServer('%s', %d)\n"
								 "dbg.addLuaState()\n"
								 "end"
								 "";

	char loadstr[200];
	sprintf(loadstr, lua_dofunction,
			debug_ip, port);

	int oldn = lua_gettop(l->L);
	int status = luaL_dostring(l->L, loadstr);
	if (status != 0)
	{
		const char *ret = lua_tostring(l->L, -1);
		lua_settop(l->L, oldn);
		skynet_error(l->ctx, "addLuaState lua_tostring error!! err:%s",
					 ret);
		return;
	}

	lua_getglobal(l->L, "snlua_addLuaState");
	if (!lua_isfunction(l->L, -1))
	{
		const char *ret = lua_tostring(l->L, -1);
		lua_settop(l->L, oldn);
		skynet_error(
			l->ctx,
			"addLuaState lua_getglobal addLuaState error!! err:%s",
			ret);
		return;
	}

	status = lua_pcall(l->L, 0, 0, 0);
	if (status != 0)
	{
		const char *ret = lua_tostring(l->L, -1);
		lua_settop(l->L, oldn);
		skynet_error(l->ctx,
					 "addLuaState lua_pcall addLuaState error!! err:%s",
					 ret);
		return;
	}
}
```

## 将addLuaState函数插入到service_snlua.c对应位置

```c
static int
init_cb(struct snlua *l, struct skynet_context *ctx, const char *args, size_t sz)
{
	lua_State *L = l->L;
	l->ctx = ctx;
	lua_gc(L, LUA_GCSTOP, 0);
	lua_pushboolean(L, 1); /* signal for libraries to ignore env. vars. */
	lua_setfield(L, LUA_REGISTRYINDEX, "LUA_NOENV");
	luaL_openlibs(L);
	lua_pushlightuserdata(L, ctx);
	lua_setfield(L, LUA_REGISTRYINDEX, "skynet_context");
	luaL_requiref(L, "skynet.codecache", codecache, 0);
	lua_pop(L, 1);

	const char *path = optstring(ctx, "lua_path", "./lualib/?.lua;./lualib/?/init.lua");
	lua_pushstring(L, path);
	lua_setglobal(L, "LUA_PATH");
	const char *cpath = optstring(ctx, "lua_cpath", "./luaclib/?.so");
	lua_pushstring(L, cpath);
	lua_setglobal(L, "LUA_CPATH");
	const char *service = optstring(ctx, "luaservice", "./service/?.lua");
	lua_pushstring(L, service);
	lua_setglobal(L, "LUA_SERVICE");
	const char *preload = skynet_command(ctx, "GETENV", "preload");
	lua_pushstring(L, preload);
	lua_setglobal(L, "LUA_PRELOAD");

	lua_pushcfunction(L, traceback);
	assert(lua_gettop(L) == 1);

	const char *loader = optstring(ctx, "lualoader", "./lualib/loader.lua");

	int r = luaL_loadfile(L, loader);
	if (r != LUA_OK)
	{
		skynet_error(ctx, "Can't load %s : %s", loader, lua_tostring(L, -1));
		report_launcher_error(ctx);
		return 1;
	}
	lua_pushlstring(L, args, sz);
	r = lua_pcall(L, 1, 0, 1);
	if (r != LUA_OK)
	{
		skynet_error(ctx, "lua loader error : %s", lua_tostring(L, -1));
		report_launcher_error(ctx);
		return 1;
	}
	lua_settop(L, 0);
	if (lua_getfield(L, LUA_REGISTRYINDEX, "memlimit") == LUA_TNUMBER)
	{
		size_t limit = lua_tointeger(L, -1);
		l->mem_limit = limit;
		skynet_error(ctx, "Set memory limit to %.2f M", (float)limit / (1024 * 1024));
		lua_pushnil(L);
		lua_setfield(L, LUA_REGISTRYINDEX, "memlimit");
	}
	lua_pop(L, 1);

	lua_gc(L, LUA_GCRESTART, 0);
	addLuaState(l); //插入到这个地方
	return 0;
}
```

## 重编skynet代码

```sh
cd skynet
make linux
```

## 下载blueprint_core.so

```sh
cd cservice
wget https://github.com/505384662/blueprint_debugger/releases/download/1.3.0/linux-x64.zip
unzip linux-x64.zip
chmod 777 blueprint_core.so
```

## 在config里面加上两个字段

```sh
debug_ip = "10.5.32.10"
debug_port = "9969"
```

## 创建.json文件

```json
{
    // 使用 IntelliSense 了解相关属性。 
    // 悬停以查看现有属性的描述。
    // 欲了解更多信息，请访问: https://go.microsoft.com/fwlink/?linkid=830387
    "version": "0.2.0",
    "configurations": [
        {
            "type": "lua_new",
            "request": "launch",
            "name": "Lua New Debug",
            "host": "10.5.32.10",
            "port": 9969,
            "ext": [
                ".lua",
                ".lua.txt",
                ".lua.bytes"
            ],
            "ideConnectDebugger": true
        }
    ]
}
```

## 展示