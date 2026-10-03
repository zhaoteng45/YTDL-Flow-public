/// <reference types="vite/client" />

/* eslint-disable @typescript-eslint/no-explicit-any */
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  // biome-ignore lint/suspicious/noExplicitAny: Standard Vue SFC module shim
  const component: DefineComponent<object, object, any>;
  export default component;
}
