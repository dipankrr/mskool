import "i18next";

import type { defaultNS, resources } from "./index";

/** Typed keys: a `t("kit:sample.titl")` typo is a compile error. */
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNS;
    resources: (typeof resources)["en"];
  }
}
