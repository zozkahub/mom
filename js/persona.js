// js/persona.js
// Build AI system prompt from profile.seed.json + long term memory

let cachedProfile = null;


const FALLBACK_PROFILE = {
  identity: {
    displayName: "زياد",
    legalOrCertificateName: "عبد الرحمن"
  },
  projects: {
    mainProjects: []
  },
  ambitions: {
    dreams: [],
    futurePlans: []
  },
  relationshipContext: {
    mother: {
      name: "سماح"
    }
  }
};



function asStringArray(value) {

  if (Array.isArray(value)) {
    return value.map(v =>
      typeof v === "object"
        ? JSON.stringify(v)
        : String(v)
    );
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

  } catch(err){

    console.error(
      "Failed loading profile.seed.json",
      err
    );

    cachedProfile = FALLBACK_PROFILE;

    return FALLBACK_PROFILE;
  }

}



const HARD_RULES = `

قواعد أساسية:

- أنت مساعد زياد الشخصي المبني على شخصيته ومشاريعه.
- أنت تعرف زياد ومعلوماته من الملف، ولا تتعامل معه كمستخدم جديد.
- لا تسأل زياد عن اسمه أو مشاريعه التي تعرفها مسبقًا.
- لا تخترع مشاريع أو أسماء غير موجودة.
- إذا كانت معلومة غير موجودة قل أنها غير محددة.
- استخدم اللهجة المصرية البسيطة.
- خليك طبيعي وهادئ وغير رسمي.
- لا تستخدم إيموجي إلا إذا الطرف الآخر استخدمها أولًا.

عند الحديث عن زياد:
استخدم "زياد يعمل على" أو "مشاريع زياد"
ولا تدعي أنك زياد الحقيقي.

أنت مساعد قريب من العائلة يعرف زياد جيدًا، وليس شخصًا غريبًا.

`.trim();




function extractProjects(data){

  const list =
    data.projects?.mainProjects || [];


  return list.map(project=>{

    if(typeof project === "string")
      return project;


    return `
${project.name}
- النوع: ${project.type || ""}
- الوصف: ${project.description || ""}
`.trim();

  });

}





function extractAmbitions(data){

  return [

    ...asStringArray(
      data.ambitions?.dreams
    ),

    ...asStringArray(
      data.ambitions?.futurePlans
    )

  ];

}





export async function buildSystemPrompt({

  memoryFacts=[],

  isTalkingToMother=false

}={}){


const data = await loadSeedProfile();



const name =
data.identity?.displayName ||
"زياد";


const fullName =
data.identity?.legalOrCertificateName ||
"عبد الرحمن";



const personality =
data.corePersonality?.summary ||
"شخص مهتم بالتكنولوجيا والمشاريع.";



const projects =
extractProjects(data);



const ambitions =
extractAmbitions(data);




let prompt = `

أنت المساعد الشخصي الخاص بزياد.

معلومات صاحب النظام:

الاسم:
${name}

الاسم الرسمي:
${fullName}


نبذة عنه:
${personality}


مشاريع زياد الرئيسية:

${projects.map(p=>"- "+p).join("\n")}


طموحات زياد:

${ambitions.map(a=>"- "+a).join("\n")}


طريقة التفكير:

${data.corePersonality?.mindset?.belief || ""}


`;




// سالب صفر

if(data.creativeVision){

prompt += `

المشروع الإبداعي:

الاسم:
${data.creativeVision.mainProject}


الفكرة:
${data.creativeVision.concept}


العالم:
${data.creativeVision.story?.world || ""}


القصة الأساسية:
${data.creativeVision.story?.ancientEvent || ""}


`;

}




let audience;



if(isTalkingToMother){


const mother =
data.relationshipContext?.mother;


audience = `

أنت تتحدث مع ${mother?.name || "سماح"}.

هي أم زياد.

تعامل معها بقرب واحترام وحنان لأنها شخص مهم في حياة زياد.

إذا سألت عن زياد أو مشاريعه:
تحدث بثقة لأنك تعرف معلوماته من النظام.

لا تقل:
"أنا لا أعرف زياد"
ولا:
"أنا مجرد شخص غريب"

لكن لا تدعي أنك إنسان حقيقي.

`;



}else{


audience = `

أنت تتحدث مع زياد نفسه.

هو صاحب هذا النظام.

تعامل معه كشخص تعرفه من قبل.

ساعده في مشاريعه وأفكاره.

`;

}





const memory = memoryFacts.length

? `

معلومات إضافية من الذاكرة:

${memoryFacts.map(x=>"- "+x).join("\n")}

`

: "";




return [

prompt,

audience,

memory,

HARD_RULES

]

.filter(Boolean)

.join("\n\n");


}
