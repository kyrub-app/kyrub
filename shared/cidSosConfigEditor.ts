export const CID_SOS_CHANNEL_LABELS={email:'E-mail',whatsapp:'WhatsApp',sms:'SMS'} as const;
export type CidEditorChannel=keyof typeof CID_SOS_CHANNEL_LABELS;
export type CidEditorPerson={id:string;name:string;channels:{channel:CidEditorChannel;address:string}[]};
export type CidEditorDraft={expectedRevision:number;enabled:boolean;owner:CidEditorPerson;contacts:CidEditorPerson[]};
export type CidEditorView={draft:CidEditorDraft;verified:{participantId:string;channel:CidEditorChannel;address:string}[]};
export type CidEditorAdapter={
 read:()=>Promise<CidEditorView>;
 save:(draft:CidEditorDraft)=>Promise<void>;
 requestConsent:(participantId:string,channel:CidEditorChannel)=>Promise<void>;
};
