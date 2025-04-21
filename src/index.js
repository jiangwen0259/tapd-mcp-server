#!/usr/bin/env node
"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const axios_1 = __importDefault(require("axios"));
const TAPD_API_URL = 'https://api.tapd.cn';
const TAPD_API_KEY = 'REprOFc0U286M0FEQTgxODUtMTVDMy1EMUNBLTQ5N0YtNEM5RTVDMDhFQjJB';
class TapdBugServer {
    constructor() {
        this.server = new index_js_1.Server({
            name: 'tapd-bug-server',
            version: '0.1.0',
        }, {
            capabilities: {
                resources: {},
                tools: {},
            },
        });
        this.axiosInstance = axios_1.default.create({
            baseURL: TAPD_API_URL,
            headers: {
                'Authorization': `Basic ${Buffer.from(TAPD_API_KEY).toString('base64')}`
            }
        });
        this.setupToolHandlers();
        this.server.onerror = (error) => console.error('[MCP Error]', error);
        process.on('SIGINT', () => __awaiter(this, void 0, void 0, function* () {
            yield this.server.close();
            process.exit(0);
        }));
    }
    setupToolHandlers() {
        this.server.setRequestHandler(types_js_1.ListToolsRequestSchema, () => __awaiter(this, void 0, void 0, function* () {
            return ({
                tools: [
                    {
                        name: 'get_bug_details',
                        description: 'Get TAPD bug details by bug ID',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                bug_id: {
                                    type: 'string',
                                    description: 'TAPD bug ID'
                                }
                            },
                            required: ['bug_id']
                        }
                    }
                ]
            });
        }));
        this.server.setRequestHandler(types_js_1.CallToolRequestSchema, (request) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            if (request.params.name !== 'get_bug_details') {
                throw new types_js_1.McpError(types_js_1.ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
            }
            const bugId = (_a = request.params.arguments) === null || _a === void 0 ? void 0 : _a.bug_id;
            if (!bugId || typeof bugId !== 'string') {
                throw new types_js_1.McpError(types_js_1.ErrorCode.InvalidParams, 'bug_id parameter is required and must be a string');
            }
            try {
                const response = yield this.axiosInstance.get(`/bugs/${bugId}`);
                return {
                    content: [{
                            type: 'text',
                            text: JSON.stringify(response.data, null, 2)
                        }]
                };
            }
            catch (error) {
                if (axios_1.default.isAxiosError(error)) {
                    return {
                        content: [{
                                type: 'text',
                                text: `TAPD API error: ${((_c = (_b = error.response) === null || _b === void 0 ? void 0 : _b.data) === null || _c === void 0 ? void 0 : _c.message) || error.message}`
                            }],
                        isError: true
                    };
                }
                throw error;
            }
        }));
    }
    run() {
        return __awaiter(this, void 0, void 0, function* () {
            const transport = new stdio_js_1.StdioServerTransport();
            yield this.server.connect(transport);
            console.error('TAPD Bug MCP server running on stdio');
        });
    }
}
const server = new TapdBugServer();
server.run().catch(console.error);
