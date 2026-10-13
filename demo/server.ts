import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildDemoServer } from "./build.js";

await buildDemoServer().connect(new StdioServerTransport());
