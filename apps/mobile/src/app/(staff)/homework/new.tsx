import { HomeworkFormScreen } from "../../../screens/homework/form";

/** Thin route: the same form handles create and edit by its `id` param. */
export default function HomeworkNewRoute() {
  return <HomeworkFormScreen />;
}
