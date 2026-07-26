// netlify/functions/chat.js
// OpenRouter proxy for Personal AI Assistant

const MODEL_CHAIN = [
  "inclusionai/ling-3.0-flash:free",
  "google/gemini-2.0-flash-exp:free",
  "qwen/qwen-2.5-72b-instruct:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "mistralai/mistral-7b-instruct:free"
];


exports.handler = async (event) => {

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({
        error: "Method Not Allowed"
      })
    };
  }


  const apiKey = process.env.OPENROUTER_API_KEY;


  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "OPENROUTER_API_KEY غير موجود"
      })
    };
  }



  let body;

  try {
    body = JSON.parse(event.body);

  } catch {

    return {
      statusCode:400,
      body:JSON.stringify({
        error:"JSON غير صحيح"
      })
    };

  }



  const {
    messages,
    systemPrompt
  } = body;



  if(!Array.isArray(messages)){

    return {
      statusCode:400,
      body:JSON.stringify({
        error:"messages غير موجودة"
      })
    };

  }



  const finalMessages =
    systemPrompt
    ?
    [
      {
        role:"system",
        content:systemPrompt
      },
      ...messages
    ]
    :
    messages;




  let errors = [];



  for(const model of MODEL_CHAIN){


    try{


      const response = await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {

          method:"POST",

          headers:{

            "Content-Type":"application/json",

            "Authorization":`Bearer ${apiKey}`,

            "HTTP-Referer":"https://your-site.netlify.app",

            "X-Title":"Ziad Personal AI"

          },


          body:JSON.stringify({

            model:model,

            messages:finalMessages,

            temperature:0.6,

            max_tokens:2000

          })

        }
      );



      const text = await response.text();



      let data;

      try{

        data = JSON.parse(text);

      }catch{

        data = {};

      }




      if(!response.ok){


        errors.push(
          `${model}: ${response.status} ${text}`
        );


        continue;

      }



      const reply =
        data?.choices?.[0]?.message?.content;



      if(!reply){


        errors.push(
          `${model}: no reply`
        );


        continue;

      }




      return {

        statusCode:200,

        body:JSON.stringify({

          reply,

          modelUsed:model

        })

      };



    }catch(error){


      errors.push(
        `${model}: ${error.message}`
      );


    }


  }



  return {

    statusCode:502,

    body:JSON.stringify({

      error:"كل النماذج فشلت",

      details:errors

    })

  };


};
