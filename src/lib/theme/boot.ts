import type { Season } from '@/lib/data/types';

/** Halloween Sep 1 through Nov 5, Christmas otherwise. Mirrors BOOT_SCRIPT below. */
export function bootSeasonForDate(d: Date): Season {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return m === 9 || m === 10 || (m === 11 && day <= 5) ? 'halloween' : 'christmas';
}

/** Constant string: no data is ever interpolated into it. */
export const BOOT_SCRIPT = `(function(){try{var s=localStorage.getItem('lastSeason:default');}catch(e){}
if(s!=='halloween'&&s!=='christmas'){var d=new Date(),m=d.getMonth()+1,day=d.getDate();
s=(m===9||m===10||(m===11&&day<=5))?'halloween':'christmas';}
document.documentElement.setAttribute('data-theme',s);})();`;
