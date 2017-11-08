export declare type Method = "GET" | "POST" | "PUT" | "DELETE";
export interface RestData {
    method: Method;
    path: string;
    headers: object;
    body?: object;
    status?: number;
}
export interface TunnelMessage {
    command: string;
    session: string;
    data?: RestData;
    channel: string;
    error?: any;
}
