#!/usr/bin/env python3
"""真实对端 smoke：用官方 Python MCP 客户端（`mcp` 1.30.0，协议 2025-11-25）经 stdio 拉起
`bin/pm-mcp.mjs`，完成 initialize → tools/list → tools/call（AC-25 的证据来源）。

- 环境变量：PM_API_URL / PM_API_TOKEN 会**原样继承**给子进程（不设 token 也能跑，用于 AC-26 ③）。
- 用法：`.venv/bin/python tools/mcp-client-smoke.py <查询词> <prompt_id> [--skip-calls]`
- 输出：每步一行 JSON（stdout），便于 shell/python 断言；失败（握手不成功等）退出码 1。
"""

from __future__ import annotations

import asyncio
import json
import os
import sys

from mcp import ClientSession, StdioServerParameters, types
from mcp.client.stdio import stdio_client

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENTRY = os.path.join(PROJECT_ROOT, "bin", "pm-mcp.mjs")


def emit(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def text_of(result: object) -> str:
    content = getattr(result, "content", None) or []
    parts = [c.text for c in content if isinstance(c, types.TextContent)]
    return "\n".join(parts)


async def main() -> int:
    if len(sys.argv) < 3:
        sys.stderr.write("用法：mcp-client-smoke.py <查询词> <prompt_id> [--skip-calls]\n")
        return 2
    query = sys.argv[1]
    prompt_id = int(sys.argv[2])
    skip_calls = "--skip-calls" in sys.argv[3:]

    emit(
        {
            "step": "peer",
            "client": "python-mcp",
            "client_version": __import__("importlib.metadata", fromlist=["version"]).version("mcp"),
            "peer_latest_protocol_version": types.LATEST_PROTOCOL_VERSION,
            "entry": ENTRY,
        }
    )

    params = StdioServerParameters(
        command=os.environ.get("MCP_NODE", "/usr/bin/node"),
        args=[ENTRY],
        env=dict(os.environ),
    )

    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            init = await session.initialize()
            emit(
                {
                    "step": "initialize",
                    "protocolVersion": init.protocolVersion,
                    "serverName": init.serverInfo.name,
                    "serverVersion": init.serverInfo.version,
                    "hasToolsCapability": init.capabilities.tools is not None,
                }
            )

            tools = await session.list_tools()
            emit({"step": "tools/list", "tools": sorted(t.name for t in tools.tools)})

            if skip_calls:
                return 0

            search = await session.call_tool("prompt_search", {"query": query})
            emit({"step": "prompt_search", "isError": bool(search.isError), "text": text_of(search)})

            got = await session.call_tool("prompt_get", {"id": prompt_id})
            emit({"step": "prompt_get", "isError": bool(got.isError), "text": text_of(got)})

            render = await session.call_tool("prompt_render", {"id": prompt_id, "values": {"姓名": "张三"}})
            emit({"step": "prompt_render", "isError": bool(render.isError), "text": text_of(render)})

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(main()))
    except Exception as exc:  # noqa: BLE001 —— smoke 脚本：任何异常都要以非 0 退出并可读
        sys.stderr.write(f"error: {type(exc).__name__}: {exc}\n")
        raise SystemExit(1) from exc
