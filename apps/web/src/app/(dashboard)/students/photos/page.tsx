import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { BulkPhotos } from "@/features/students/bulk-photos";
import { copy } from "@/lib/copy";

export const metadata: Metadata = { title: copy.bulkPhotos.title };

export default function StudentPhotosPage() {
  return (
    <>
      <PageHeader
        title={copy.bulkPhotos.title}
        description={copy.bulkPhotos.subtitle}
      />
      <BulkPhotos />
    </>
  );
}
