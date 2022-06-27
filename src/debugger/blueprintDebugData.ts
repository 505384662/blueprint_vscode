import * as proto from "./blueprintDebugProto";
import { DebugProtocol } from "vscode-debugprotocol";
import { Handles } from "vscode-debugadapter";

export interface IblueprintStackContext {
    handles: Handles<IblueprintStackNode>;
    eval(expr: string, cacheId: number, depth: number): Promise<proto.IEvalRsp>;
}

export interface IblueprintStackNode {
    toVariable(ctx: IblueprintStackContext): DebugProtocol.Variable;
    toIVariable(ctx: IblueprintStackContext): proto.IVariable;
    computeChildren(ctx: IblueprintStackContext): Promise<Array<IblueprintStackNode>>;
    getIVariable(ctx: IblueprintStackContext, name: string): proto.IVariable | undefined;
    getTableExpr(ctx: IblueprintStackContext): string | undefined;
}

export class blueprintLocalValueStack implements IblueprintStackNode {
    constructor(
        public data: proto.IStack
    ) {
    }

    toVariable(ctx: IblueprintStackContext): DebugProtocol.Variable {
        throw new Error('Method not implemented.');
    }


    toIVariable(ctx: IblueprintStackContext): proto.IVariable {
        throw new Error("Method not implemented.");
    }


    async computeChildren(ctx: IblueprintStackContext): Promise<Array<IblueprintStackNode>> {
        const variables = this.data.localVariables;
        return variables.map(v => {
            return new blueprintVariable(v);
        });
    }

    getIVariable(ctx: IblueprintStackContext, name: string): proto.IVariable | undefined {
        const variables = this.data.localVariables;
        return variables.find(v => {
            return v.name === name;
        });
    }

    getTableExpr(ctx: IblueprintStackContext): string | undefined {
        return undefined;
    }
}

export class blueprintUpValueStack implements IblueprintStackNode {
    constructor(
        public data: proto.IStack
    ) {
    }

    toVariable(ctx: IblueprintStackContext): DebugProtocol.Variable {
        throw new Error('Method not implemented.');
    }

    toIVariable(ctx: IblueprintStackContext): proto.IVariable {
        throw new Error("Method not implemented.");
    }

    getIVariable(ctx: IblueprintStackContext, name: string): proto.IVariable | undefined {
        const variables = this.data.upvalueVariables;
        return variables.find(v => {
            return v.name === name;
        });
    }

    async computeChildren(ctx: IblueprintStackContext): Promise<Array<IblueprintStackNode>> {
        const variables = this.data.upvalueVariables;
        return variables.map(v => {
            return new blueprintVariable(v);
        });
    }


    getTableExpr(ctx: IblueprintStackContext): string | undefined {
        return undefined;
    }
}


export class blueprintVariable implements IblueprintStackNode {
    private variable: DebugProtocol.Variable;
    constructor(
        private data: proto.IVariable,
        private parent?: blueprintVariable,
    ) {
        let value = this.data.value;
        switch (this.data.valueType) {
            case proto.ValueType.TSTRING:
                value = `"${this.data.value}"`;
                break;
        }
        let name = this.data.name;
        switch (this.data.nameType) {
            case proto.ValueType.TSTRING:
                break;
            default:
                name = `[${name}]`;
                break;
        }

        this.variable = { name: name, value: value, variablesReference: 0 };
    }

    toVariable(ctx: IblueprintStackContext): DebugProtocol.Variable {
        const ref = ctx.handles.create(this);
        if (this.data.valueType === proto.ValueType.TTABLE ||
            this.data.valueType === proto.ValueType.TUSERDATA ||
            this.data.valueType === proto.ValueType.GROUP) {
            this.variable.variablesReference = ref;
        }
        return this.variable;
    }

    toIVariable(ctx: IblueprintStackContext): proto.IVariable {
        return this.data;
    }

    private getExpr(): string {
        let arr: proto.IVariable[] = [];
        let n: blueprintVariable | undefined = this;
        while (n) {
            if (n.data.valueType !== proto.ValueType.GROUP) {
                arr.push(n.data);
            }
            n = n.parent;
        }
        arr = arr.reverse();
        return arr.map(it => it.name).join('.');
    }

    private getExpr2(): string {
        let arr: proto.IVariable[] = [];
        let n: blueprintVariable | undefined = this;
        while (n) {
            if (n.data.valueType !== proto.ValueType.GROUP) {
                arr.push(n.data);
            }
            n = n.parent;
        }
        arr = arr.reverse();
        return arr.map(it => it.nameType !== proto.ValueType.TSTRING ? `[${it.name}]` : it.name).join('.');
    }

    sortVariables(a: proto.IVariable, b: proto.IVariable): number {
        const w1 = a.valueType > proto.ValueType.TTHREAD ? 0 : 1;
        const w2 = b.valueType > proto.ValueType.TTHREAD ? 0 : 1;
        if (w1 !== w2) {
            return w1 - w2;
        }
        return a.name.localeCompare(b.name);
    }

    async computeChildren(ctx: IblueprintStackContext): Promise<IblueprintStackNode[]> {
        let children = this.data.children;
        if (this.data.valueType === proto.ValueType.GROUP) {
            children = this.data.children;
        }
        else {
            const evalResp = await ctx.eval(this.getExpr(), this.data.cacheId, 2);
            if (evalResp.success) {
                children = evalResp.value.children;
            }
        }
        if (children) {
            return children.sort(this.sortVariables).map(v => new blueprintVariable(v, this));
        }
        return [];
    }

    getIVariable(ctx: IblueprintStackContext): proto.IVariable | undefined {
        let n: blueprintVariable | undefined = this;

        return n.data;
    }

    getTableExpr(ctx: IblueprintStackContext): string | undefined {
        return this.getExpr2();
    }
}
