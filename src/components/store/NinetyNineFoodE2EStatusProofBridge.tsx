import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  KYRUB_99FOOD_E2E_TEST_SUBJECT_CHANGED_EVENT,
  readNinetyNineFoodE2ETestSubject,
  type NinetyNineFoodE2ETestSubject,
} from '../../utils/ninetyNineFoodE2ETestSubject';
import NinetyNineFoodE2EStatusProofPanel from './NinetyNineFoodE2EStatusProofPanel';

export default function NinetyNineFoodE2EStatusProofBridge({
  user,
}: {
  user: User;
}) {
  const [subject, setSubject] = useState<NinetyNineFoodE2ETestSubject | null>(
    () => readNinetyNineFoodE2ETestSubject(user.uid)
  );

  useEffect(() => {
    const sync = (): void => {
      setSubject(readNinetyNineFoodE2ETestSubject(user.uid));
    };
    const handleChanged = (event: Event): void => {
      const detail = (event as CustomEvent<{ storeId?: string }>).detail;
      if (detail?.storeId?.trim() !== user.uid) return;
      sync();
    };
    sync();
    window.addEventListener(
      KYRUB_99FOOD_E2E_TEST_SUBJECT_CHANGED_EVENT,
      handleChanged
    );
    return () => {
      window.removeEventListener(
        KYRUB_99FOOD_E2E_TEST_SUBJECT_CHANGED_EVENT,
        handleChanged
      );
    };
  }, [user.uid]);

  if (!subject) return null;
  return <NinetyNineFoodE2EStatusProofPanel user={user} subject={subject} />;
}
