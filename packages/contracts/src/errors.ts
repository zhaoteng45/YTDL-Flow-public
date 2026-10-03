export type JSONPrimitive = string | number | boolean | null;
export type JSONValue = JSONPrimitive | JSONValue[] | { [key: string]: JSONValue };

export interface ErrorPayload {
  code: string;
  message: string;
  details?: JSONValue;
}
