import { MessageSquareText } from 'lucide-react';
import { openStoreCustomerChat } from '../../utils/storeCustomerChatEvents';

interface StoreCustomerChatLauncherProps {
  storeId: string;
  storeName: string;
}

export function StoreCustomerChatLauncher({
  storeId,
  storeName,
}: StoreCustomerChatLauncherProps) {
  return (
    <button
      type="button"
      onClick={() =>
        openStoreCustomerChat({
          perspective: 'customer',
          storeId,
          storeName,
        })
      }
      className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-orange-500/25 bg-orange-500/10 px-4 text-[10px] font-black uppercase text-orange-300 transition-colors hover:bg-orange-500/15"
      id="customer-store-chat-launcher"
    >
      <MessageSquareText className="h-4 w-4" />
      Conversar com {storeName || 'a loja'}
    </button>
  );
}
