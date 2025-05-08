import type { DocumentTypeDecoration } from "@graphql-typed-document-node/core";

export class TypedDocumentString<TResult, TVariables>
  extends String
  implements DocumentTypeDecoration<TResult, TVariables>
{
  __apiType?: DocumentTypeDecoration<TResult, TVariables>["__apiType"];

  constructor(
    private value: string,
    public __meta__: Record<string, unknown> | undefined
  ) {
    super(value);
  }

  // Choosing a leaf type will trigger the print visitor to output the value directly
  // instead of trying to visit the children
  kind = "IntValue";
}
