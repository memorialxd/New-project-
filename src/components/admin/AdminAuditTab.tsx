import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Activity, ScrollText } from 'lucide-react';
import AdminActivityLog from './AdminActivityLog';
import AdminAuditLog from './AdminAuditLog';

export default function AdminAuditTab() {
  const [tab, setTab] = useState('activity');
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2 min-w-0">
        <h2 className="admin-section-title truncate">Activity & Audit</h2>
        <span className="admin-section-sub truncate">· ενοποιημένη προβολή ενεργειών</span>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-9">
          <TabsTrigger value="activity" className="text-xs gap-1.5 h-7">
            <Activity className="h-3.5 w-3.5" /> Activity
          </TabsTrigger>
          <TabsTrigger value="audit" className="text-xs gap-1.5 h-7">
            <ScrollText className="h-3.5 w-3.5" /> Audit
          </TabsTrigger>
        </TabsList>
        <TabsContent value="activity" className="mt-3">
          <AdminActivityLog />
        </TabsContent>
        <TabsContent value="audit" className="mt-3">
          <AdminAuditLog />
        </TabsContent>
      </Tabs>
    </div>
  );
}
