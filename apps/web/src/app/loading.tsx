import Spinner4 from "@/components/ui/spinner4";

export default function Loading() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="h-16 w-16">
        <Spinner4 />
      </div>
    </div>
  );
}