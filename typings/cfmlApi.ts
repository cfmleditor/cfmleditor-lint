import {Uri, Range, TextDocument, Location} from "vscode";

export interface Component {
    uri: Uri;
    name: string;
    isScript: boolean;
    isInterface: boolean; // should be a separate type, but chose this for the purpose of simplification
    declarationRange: Range;
    displayname: string;
    hint: string;
    accessors: boolean;
    initmethod?: string;
    extends?: Uri;
    extendsRange?: Range;
    implements?: Uri[];
    implementsRanges?: Range[];
    functions: ComponentFunctions;
    properties: Properties;
    variables: Variable[];
    imports: string[];
}

export interface DocumentStateContext {
    document: TextDocument;
    isCfmFile: boolean;
    isCfcFile: boolean;
    docIsScript: boolean;
    commentRanges: Range[];
    stringRanges?: Range[];
    stringEmbeddedCfmlRanges?: Range[];
    sanitizedDocumentText: string;
    component?: Component;
    userEngine: object; // CFMLEngine
}

export interface Variable {
    identifier: string;
    dataType: DataType;
    dataTypeComponentUri?: Uri; // Only when dataType is Component
    scope: Scope;
    final: boolean;
    declarationLocation: Location;
    description?: string;
    initialValue?: string;
}

export enum DataType {
    Any = "any",
    Array = "array",
    Binary = "binary",
    Boolean = "boolean",
    Component = "component",
    Date = "date",
    Function = "function",
    GUID = "guid",
    Numeric = "numeric",
    Query = "query",
    String = "string",
    Struct = "struct",
    UUID = "uuid",
    VariableName = "variablename",
    Void = "void",
    XML = "xml"
}

export enum Scope {
    Application = "application",
    Arguments = "arguments",
    Attributes = "attributes",
    Caller = "caller",
    Cffile = "cffile",
    CGI = "cgi",
    Client = "client",
    Cookie = "cookie",
    Flash = "flash",
    Form = "form",
    Local = "local",
    Request = "request",
    Server = "server",
    Session = "session",
    Static = "static", // Lucee-only
    This = "this",
    ThisTag = "thistag",
    Thread = "thread",
    ThreadLocal = "threadlocal", // Not a real prefix
    URL = "url",
    Unknown = "unknown", // Not a real scope. Use as default.
    Variables = "variables"
}

export type Properties = Map<string, Property>

export interface Property {
    name: string;
    dataType: DataType;
    dataTypeComponentUri?: Uri; // Only when dataType is Component
    description?: string;
    getter?: boolean;
    setter?: boolean;
    nameRange: Range;
    dataTypeRange?: Range;
    propertyRange: Range;
    default?: string;
}

export type ComponentFunctions = Map<string, UserFunction>

export interface UserFunction extends Function {
    access: Access;
    static: boolean;
    abstract: boolean;
    final: boolean;
    returnTypeUri?: Uri; // Only when returntype is Component
    returnTypeRange?: Range;
    nameRange: Range;
    bodyRange?: Range;
    signatures: UserFunctionSignature[];
    location: Location;
    isImplicit: boolean;
}

export interface Function {
    name: string;
    description: string;
    returntype: DataType;
    signatures: Signature[];
}

export interface Signature {
    parameters: Parameter[];
    description?: string;
}

export interface Parameter {
    name: string;
    description: string;
    dataType: DataType;
    required: boolean;
    default?: string;
    enumeratedValues?: string[];
}

export interface UserFunctionSignature extends Signature {
    parameters: Argument[];
}

export interface Argument extends Parameter {
    // description is hint
    nameRange: Range;
    dataTypeRange?: Range;
    dataTypeComponentUri?: Uri; // Only when dataType is Component
}

export enum Access {
    Public = "public",
    Private = "private",
    Package = "package",
    Remote = "remote"
}
