export interface ParsedTarget {
    identifier: string;
    type: "username" | "phone";
    valid: boolean;
}
export declare function parseTargets(raw: string): ParsedTarget[];
