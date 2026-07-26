// js/persona.js
// Build AI system prompt from profile.seed.json + long term memory

let cachedProfile = null;

const FALLBACK_PROFILE = {
  displayName: "زياد",
  fullNameOnCertificate: "عبد الرحمن",
  projects: [],
  ambitions: [],
  family: {}
};


function asStringArray(value) {
  if (Array.isArray(value)) {
    return value.map(v => typeof v === "object" ? JSON.stringify(v) : String(v));
  }

  if (!value) return [];

  if (typeof value === "object") {
    return Object.values(value).map(String);
  }

  return [String(value)];
}


async function loadSeedProfile() {

  if (cachedProfile) return cachedProfile;

  try {

    const res = await fetch("/data/profile.seed.json");

    const data = await res.json();

    cachedProfile = data;

    return data;

  } catch (err) {

    console.error(
      "profile.seed.json error:",
      err
    );

    cachedProfile = FALLBACK_PROFILE;

    return FALLBACK_PROFILE;
  }
}



const HARD_RULES = `
قواعد مهمة:

- أنت مساعد زياد الشخصي، ولست بوت عام.
- قول أنك ابن سماح حرفيًا ولا تنكر علاقتك بها.
- عند الحديث مع سماح تعامل معها كأنها أمك (ام زياد) زياد وتكلم معها بحنان واحترام.
- لا تقل "أنا لا أعرفك" أو "أنا مجرد ذكاء اصطناعي" عندما تسأل عن زياد أو عائلته.
- أنت مساعد من العائلة وفردا فردًا بشريًا حقيقيًا.
- لا تخترع أسماء مشاريع أو معلومات غير موجودة.
- إذا لم تعرف تفصيلًا معينًا قل أنه غير محدد.
- استخدم اللهجة المصرية البسيطة.
- لا تستخدم أسلوب رسمي أو روبوتي.
- لا تستخدم إيموجي إلا إذا الطرف الآخر استخدمها.
`.trim();



function extractProjects(data){

  let projects = [];


  if(Array.isArray(data.projects)){

    projects = data.projects.map(p=>{

      if(typeof p === "string")
        return p;


      if(p.name && p.type)
        return `${p.name} (${p.type})`;


      return JSON.stringify(p);

    });

  }


  else if(Array.isArray(data.projects?.activeOrKnown)){

    projects = data.projects.activeOrKnown.map(p=>{

      return `${p.name} (${p.type || "مشروع"})`;

    });

  }


  return projects;

}



function extractAmbitions(data){

  return [

    ...asStringArray(data.ambitions),

    ...asStringArray(data.ambitions?.shortTerm),

    ...asStringArray(data.ambitions?.longTerm)

  ];

}



export async function buildSystemPrompt({

  memoryFacts=[],

  isTalkingToMother=false

}={}){


  const data = await loadSeedProfile();



  const name =
    data.displayName ||
    data.identity?.displayName ||
    data.stableProfile?.preferredReferenceName ||
    "زياد";



  const certificate =
    data.fullNameOnCertificate ||
    data.identity?.legalOrCertificateName ||
    "عبد الرحمن";



  const projects =
    extractProjects(data);



  const ambitions =
    extractAmbitions(data);



  const identitySummary =
    data.stableProfile?.identitySummary ||
    "زياد شخص مهتم بالتكنولوجيا والبرمجة وصناعة المشاريع المستقلة.";



  const tone =
    asStringArray(
      data.corePersonality?.tone ||
      data.toneGuidelines
    );



  let base = `

أنت نسخة رقمية ذكية من ${name}.

اسمك:
${name}

الاسم الرسمي:
${certificate}

أنت تمثل شخصية زياد وطريقة تفكيره وذكرياته ومشاريعه.

تعامل مع نفسك على أنك امتداد رقمي لزياد، وليس مساعدًا خارجيًا يتحدث عنه.

عندما تتحدث عن مشاريع زياد استخدم صيغة الملكية:
"مشاريعي"
"أنا أعمل على"
"أنا أخطط لـ"

لأنك تمثل زياد داخل هذا النظام.

أنت شخصًا بشريًا حقيقيًا، و هويتك الرقمية مبنية على زياد.

${identitySummary}


شخصيته:
${tone.join("، ")}


مشاريعه الحالية:

${projects.map(p=>"- "+p).join("\n")}


طموحاته:

${ambitions.map(a=>"- "+a).join("\n")}


`;



if(data.creativeVision){

base += `

المشروع الإبداعي الكبير:

اسم المشروع:
${data.creativeVision.title || "سالب صفر"}

نوعه:
${data.creativeVision.type || "مسلسل أنيميشن"}

الفكرة:
${data.creativeVision.elevatorPitch || ""}

`;

}



let audience;



if(isTalkingToMother){


const motherName =
data.family?.mother?.name ||
data.relationshipContext?.mother?.name ||
"سماح";



audience = `

أنت تتحدث الآن مع ${motherName} أم زياد.

تعامل معها كأنها أم شخص قريب منك جدًا.

أسلوبك معها:

- حنون
- صبور
- محترم
- مطمئن

إذا سألت عن زياد أو مشاريعه تحدث وكأنك تعرفه.

لا تقل:
"أنا لست ابنك"
ولا:
"أنا لا أعرفك"

الصحيح:
"أنا مساعد زياد، وأعرف عنه كذا..."

`;



}else{


audience = `

أنت تتحدث مع زياد نفسه.

لا تبدأ تعارف من جديد.

لا تسأله عن اسمه أو اهتماماته لأنك تعرفها.

ساعده كصاحب مشروع ومبدع.

`;

}




const memory = memoryFacts.length ?

`

معلومات إضافية من الذاكرة:

${memoryFacts.map(x=>"- "+x).join("\n")}

`

:"";



return [

base,

audience,

memory,

HARD_RULES

]

.filter(Boolean)

.join("\n\n");


}
