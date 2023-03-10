import ts from 'typescript';
import { repeat, merge } from 'lodash';
import { TestFileParserBase } from '../../test-file-parser-base';
import TypescriptConfiguration from '../../../../configuration/typescript-configuration';

function replaceComments (code) {
    return code.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, match => {
        const lastSymbol = match.indexOf('\n') > -1 ? '\n' : ' ';

        return repeat(' ', match.length + lastSymbol);
    });
}

class TypeScriptTestFileParser extends TestFileParserBase {
    constructor () {
        super(ts.SyntaxKind);
    }

    getComputedNameString ({ pos, end }) {
        const templatePos = this.getLocationByOffsets(pos, end);

        return TestFileParserBase.formatComputedName(templatePos.loc.start.line);
    }

    getTokenType (token) {
        return token.kind;
    }

    getCalleeToken (token) {
        return token.expression;
    }

    getMemberFnName (token) {
        return token.expression.name.text;
    }

    getKeyValue (prop) {
        const { name, initializer } = prop;

        return {
            key:   name.text,
            value: this.getStringValue(initializer),
        };
    }

    getFixedStartOffset (start) {
        let fixedStartOffset = start;

        while (/\s/.test(this.codeWithoutComments[fixedStartOffset]))
            ++fixedStartOffset;

        return fixedStartOffset;
    }

    getLocationByOffsets (start, end) {
        const fixedStart = this.getFixedStartOffset(start);
        const codeArr    = this.codeArr;
        const loc        = { start: null, end: null };

        let line     = codeArr[0];
        let startTmp = fixedStart;
        let endTmp   = end;

        for (let lineNumber = 1; lineNumber <= codeArr.length; ++lineNumber, line = codeArr[lineNumber - 1]) {
            startTmp -= line.length + 1;
            endTmp -= line.length + 1;

            if (startTmp < 0 && !loc.start)
                loc.start = { line: lineNumber, column: line.length + startTmp + 1 };

            if (endTmp <= 0 || lineNumber === codeArr.length - 1) {
                loc.end = { line: lineNumber, column: line.length + endTmp + 1 };

                break;
            }
        }

        return { loc, start: fixedStart, end };
    }

    getRValue (token) {
        return token.declarationList.declarations[0].initializer;
    }

    getStringValue (token) {
        const stringTypes = [this.tokenType.StringLiteral, this.tokenType.TemplateExpression];

        if (stringTypes.indexOf(token.kind) > -1 || token.text && token.kind !== this.tokenType.NumericLiteral)
            return this.formatFnArg(token);

        return null;
    }

    isAsyncFn (token) {
        const isGeneratorFn = !!token.asteriskToken;
        const isAsyncFn     = token.modifiers &&
                              token.modifiers.some(modifier => modifier.kind === this.tokenType.AsyncKeyword);

        return isGeneratorFn || isAsyncFn;
    }

    getFunctionBody (token) {
        return token.body.statements;
    }

    formatFnData (name, value, token, meta = [{}]) {
        const loc = this.getLocationByOffsets(token.pos, token.end);

        return {
            fnName:    name,
            value:     value,
            loc:       loc.loc,
            start:     loc.start,
            end:       loc.end,
            meta:      merge({}, ...meta),
            isSkipped: TestFileParserBase.isSkipped(token),
        };
    }

    analyzeMemberExp (token) {
        let exp         = token;
        const tokenType = this.tokenType;
        const callStack = [exp];

        while (exp.kind !== this.tokenType.Identifier) {
            exp = exp.expression || exp.tag;

            callStack.push(exp);
        }

        const meta = this.getMetaInfo(callStack.slice());

        if (exp && this.isApiFn(exp.text)) {
            let parentExp = callStack.pop();

            while (parentExp) {
                if (parentExp.kind === tokenType.CallExpression && parentExp.expression) {
                    const calleeType     = parentExp.expression.kind;
                    const calleeMemberFn = calleeType === tokenType.PropertyAccessExpression &&
                                           parentExp.expression.name.text;

                    if (this.checkExpDefineTargetName(calleeType, calleeMemberFn))
                        return this.formatFnData(exp.text, this.formatFnArg(parentExp.arguments[0]), token, meta);
                }

                if (parentExp.kind === tokenType.TaggedTemplateExpression && parentExp.tag) {
                    const tagType     = parentExp.tag.kind;
                    const tagMemberFn = tagType === tokenType.PropertyAccessExpression && parentExp.tag.name.text;

                    if (this.checkExpDefineTargetName(tagType, tagMemberFn))
                        return this.formatFnData(exp.text, this.formatFnArg(parentExp), token, meta);
                }

                parentExp = callStack.pop();
            }
        }

        return null;
    }

    formatFnArg (arg) {
        if (arg.templateSpans)
            return this.getComputedNameString({ pos: arg.pos, end: arg.end });

        if (arg.head)
            return this.getComputedNameString({ pos: arg.template.pos, end: arg.template.end });

        if (arg.template)
            return arg.template.text || this.getComputedNameString({ pos: arg.template.pos, end: arg.template.end });

        if (arg.kind === this.tokenType.Identifier)
            return this.getComputedNameString({ pos: arg.pos, end: arg.end });

        if (arg.text && arg.kind !== this.tokenType.NumericLiteral)
            return arg.text;

        if (arg.kind === this.tokenType.TypeAssertionExpression)
            return this.formatFnArg(arg.expression);

        return null;
    }

    getFnCall (token) {
        if (this.isApiFn(token.expression.text))
            return this.formatFnData(token.expression.text, this.formatFnArg(token.arguments[0]), token);

        return null;
    }

    getTaggedTemplateExp (token) {
        if (this.isApiFn(token.tag.text))
            return this.formatFnData(token.tag.text, this.formatFnArg(token), token);

        return null;
    }

    analyzeFnCall (token) {
        const tokenType = this.tokenType;

        if (token.kind === tokenType.PropertyAccessExpression)
            return this.analyzeMemberExp(token);

        if (token.kind === tokenType.CallExpression) {
            const expKind = token.expression.kind;

            if (expKind === tokenType.PropertyAccessExpression || expKind === tokenType.CallExpression)
                return this.analyzeMemberExp(token);

            if (expKind === tokenType.ParenthesizedExpression)
                return this.analyzeFnCall(token.expression.expression);

            return this.getFnCall(token);
        }

        if (token.kind === tokenType.FunctionExpression || token.kind === tokenType.ArrowFunction)
            return this.collectTestCafeCalls(this.getFunctionBody(token));

        if (token.kind === tokenType.TaggedTemplateExpression) {
            if (token.tag.kind === tokenType.PropertyAccessExpression || token.tag.kind === tokenType.CallExpression)
                return this.analyzeMemberExp(token);

            return this.getTaggedTemplateExp(token);
        }

        return null;
    }

    parse (code) {
        //NOTE: TypeScript calculates start position of a token incorrectly
        //It doesn't consider spaces and comments between the last token and the current token.
        //So we replace comments with space symbols to calculate fixed position.
        //We just increment position until we meet non whitespace characters
        this.codeArr             = code.split('\n');
        this.codeWithoutComments = replaceComments(code);

        const tsConfig   = new TypescriptConfiguration();
        const sourceFile = ts.createSourceFile('', code, tsConfig.getOptions(), true);

        return this.analyze(sourceFile.statements);
    }
}

const parser = new TypeScriptTestFileParser();

export const getTypeScriptTestList         = parser.getTestList.bind(parser);
export const getTypeScriptTestListFromCode = parser.getTestListFromCode.bind(parser);
