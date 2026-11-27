// The inventory is intentionally limited to synthetic profile and settings.
// It is NOT a complete ROPA, a production data map or a full LGPD access response.
export const PRIVACY_EXPORT_CATEGORIES={
 profile:'Perfil próprio',
 preferences:'Preferências próprias'
} as const;
export type PrivacyExportCategory=keyof typeof PRIVACY_EXPORT_CATEGORIES;
export type PrivacyOwnDataExport={
 protocol:string;formatVersion:1;generatedAt:number;simulation:true;completeAccessResponse:false;
 categories:PrivacyExportCategory[];
 data:{profile?:{displayName:string;createdAt:number};preferences?:{locale:string;theme:'light'|'dark'|'system'}};
};
