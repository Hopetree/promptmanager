#!/usr/bin/env python3
"""MCP **Streamable HTTP** 的真实对端 smoke（阶段 35 / FR-93 / AC-95 ①④）。

用**官方 Python 客户端**（`mcp==1.30.0`，见 `.venv`）对 `POST /mcp` 走一遍
`initialize → tools/list → tools/call`，证明远程接入真的可用（不是自造 JSON-RPC）。

用法：
  .venv/bin/python tools/mcp-http-smoke.py <mcp-url> <token> [prompt_id]
    <mcp-url>   如 http://127.0.0.1:8766/mcp
    <token>     API Token 明文（**只在命令行出现，脚本不落盘、不打印**）
    [prompt_id] 用于 prompt_get / prompt_render 的 id，默认 1

输出（stdout）为 `key=value` 行，供 AC 脚本断言；**不打印 token**。
"""
import asyncio
import sys

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client


async def main() -> int:
    if len(sys.argv) < 3:
        print("用法: mcp-http-smoke.py <mcp-url> <token> [prompt_id]", file=sys.stderr)
        return 2
    url, token = sys.argv[1], sys.argv[2]
    prompt_id = int(sys.argv[3]) if len(sys.argv) > 3 else 1

    async with streamablehttp_client(url, headers={"Authorization": f"Bearer {token}"}) as (read, write, _):
        async with ClientSession(read, write) as session:
            init = await session.initialize()
            print(f"server_name={init.serverInfo.name}")
            print(f"server_version={init.serverInfo.version}")

            tools = await session.list_tools()
            names = [t.name for t in tools.tools]
            print(f"tool_names={','.join(names)}")
            print(f"tool_count={len(names)}")

            search = await session.call_tool("prompt_search", {"query": "AC35"})
            search_text = search.content[0].text if search.content else ""
            print(f"search_isError={bool(search.isError)}")
            print(f"search_text={search_text}".replace("\n", " "))

            got = await session.call_tool("prompt_get", {"id": prompt_id})
            got_text = got.content[0].text if got.content else ""
            print(f"get_isError={bool(got.isError)}")
            print(f"get_text={got_text}".replace("\n", " "))

            rendered = await session.call_tool("prompt_render", {"id": prompt_id, "values": {"姓名": "世界"}})
            render_text = rendered.content[0].text if rendered.content else ""
            print(f"render_isError={bool(rendered.isError)}")
            print(f"render_text={render_text}".replace("\n", " "))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
