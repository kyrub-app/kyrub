import {createRoot} from 'react-dom/client';
import {auth} from '../../src/utils/firebase';
import {PublicKyrubTagPage} from '../../src/components/PublicKyrubTagPage';
import '../../src/index.css';
if(location.origin!=='https://kyrub-tag-browser.vercel.app'||!import.meta.env.DEV||
 auth.app.options.projectId!=='demo-kyrub-welcome'||auth.emulatorConfig?.host!=='127.0.0.1'||auth.emulatorConfig?.port!==9099)throw Error('LOCAL_FIXTURE_ONLY');
const match=/^\/tag\/([a-f0-9]{32})$/.exec(location.pathname);
if(!match)throw Error('FIXTURE_TAG_REQUIRED');
createRoot(document.getElementById('root')!).render(<PublicKyrubTagPage identifier={match[1]}/>);
