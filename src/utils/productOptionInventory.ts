import type { User } from 'firebase/auth';
import {
  doc,
  runTransaction,
  serverTimestamp,
  type DocumentData,
} from 'firebase/firestore';
import {
  parseOptionInventoryImpacts,
  type OptionInventoryImpactLine,
  type OptionInventoryImpactRecord,
} from '../../shared/optionInventoryImpact';
import { db } from './firebase';
import { getProductInventoryDocumentPath } from './productInventory';

const normalizePath = (value: string): string =>
  value
    .split(/\s*(?:>|\/)\s*/)
    .map(segment =>
      segment
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLocaleLowerCase('pt-BR')
    )
    .filter(Boolean)
    .join(' > ');

const cleanLines = (value: OptionInventoryImpactLine[]): OptionInventoryImpactLine[] =>
  parseOptionInventoryImpacts([
    {
      scopeType: 'catalog_path',
      scopeId: 'Categoria > Grupo',
      groupId: 'group',
      choiceId: 'choice',
      lines: value,
    },
  ])[0]?.lines ?? [];

export const readOptionInventoryImpacts = (
  value: DocumentData | undefined
): OptionInventoryImpactRecord[] =>
  parseOptionInventoryImpacts(value?.optionInventoryImpacts);

export const getCatalogOptionInventoryImpact = (
  impacts: OptionInventoryImpactRecord[],
  path: string,
  groupId: string,
  choiceId: string
): OptionInventoryImpactRecord | null => {
  const targetPath = normalizePath(path);
  return parseOptionInventoryImpacts(impacts).find(
    impact =>
      impact.scopeType === 'catalog_path' &&
      normalizePath(impact.scopeId) === targetPath &&
      impact.groupId === groupId &&
      impact.choiceId === choiceId
  ) ?? null;
};

export const saveCatalogOptionInventoryImpact = async (
  user: Pick<User, 'uid'>,
  path: string,
  groupId: string,
  choiceId: string,
  lines: OptionInventoryImpactLine[]
): Promise<OptionInventoryImpactRecord[]> => {
  const normalizedLines = cleanLines(lines);
  const inventoryReference = doc(
    db,
    getProductInventoryDocumentPath(user.uid)
  );
  let next: OptionInventoryImpactRecord[] = [];

  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(inventoryReference);
    const current = readOptionInventoryImpacts(snapshot.data());
    const pathKey = normalizePath(path);
    const withoutCurrent = current.filter(
      impact =>
        !(
          impact.scopeType === 'catalog_path' &&
          normalizePath(impact.scopeId) === pathKey &&
          impact.groupId === groupId &&
          impact.choiceId === choiceId
        )
    );

    next = normalizedLines.length > 0
      ? parseOptionInventoryImpacts([
          ...withoutCurrent,
          {
            scopeType: 'catalog_path',
            scopeId: path,
            groupId,
            choiceId,
            lines: normalizedLines,
          },
        ])
      : withoutCurrent;

    transaction.set(
      inventoryReference,
      {
        ownerId: user.uid,
        optionInventoryImpacts: next,
        updatedAt: serverTimestamp(),
        ...(snapshot.exists() ? {} : { createdAt: serverTimestamp() }),
      },
      { merge: true }
    );
  });

  return next;
};
