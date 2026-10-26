import { CollectPaymentScreen } from "../../../../screens/fees/collect";

/**
 * Take the money. The desk passes the student's name and class so the counter
 * screen never flashes a placeholder while the student row loads.
 */
export default function FeeCollectRoute() {
  return <CollectPaymentScreen />;
}
