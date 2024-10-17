const { z } = require("zod");
const fs = require("fs/promises");
const path = require("path");
const { END, START, StateGraph } = require("@langchain/langgraph");
const { tool } = require("@langchain/core/tools");
const { MemorySaver } = require("@langchain/langgraph");
require('dotenv').config();

const { DynamicStructuredTool  } = require("@langchain/core/tools")

const { HumanMessage, BaseMessage, SystemMessage } = require("@langchain/core/messages");
const { ChatPromptTemplate, MessagesPlaceholder } = require("@langchain/core/prompts");
const { JsonOutputToolsParser } = require("langchain/output_parsers");
const { ChatOpenAI } = require("@langchain/openai");
const { Runnable } = require("@langchain/core/runnables");

const { Annotation } = require("@langchain/langgraph");
const { createReactAgent } = require("@langchain/langgraph/prebuilt");
const { StructuredOutputParser } = require("langchain/output_parsers");

const { RunnableLambda } = require("@langchain/core/runnables");

const WORKING_DIRECTORY = "./ggi-is";
fs.mkdir(WORKING_DIRECTORY, { recursive: true });
// Tools List
const creatorFile = tool(
  async ({ path_folder, file_name }) => {
    const fullPath = path.join(WORKING_DIRECTORY, path_folder, file_name);
    try {
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      const fileExists = await fs.access(fullPath).then(() => true).catch(() => false);
      let message = ``;
      if (fileExists) {
        message = `File ${file_name} sudah ada di ./${fullPath}`;
      } else {
        await fs.writeFile(fullPath, "", "utf8");
        message = `File ${file_name} berhasil dibuat di ./${fullPath}`;
      }
      console.log(message);
      return { message, path: path.dirname(fullPath) };
      // return message;
    } catch (error) {
      const message = `Error: Gagal membuat file ${file_name} di ./${fullPath}. ${error.message}`;
      console.error(message);
      return { message, path: null };
      // return message;
    }
  },
  {
    name: "creator_file",
    description: "Tools ini berfungsi untuk membuat sebuah struktur file dan folder yang dibutuhkan untuk membangun project.",
    schema: z.object({
      path_folder: z.string().describe("Path Folder untuk menyimpan file"),
      file_name: z.string().describe("Nama file yang akan dibuat"),
    }),
  }
);

const listFilesAndFolders = tool(
  async ({ path_folder }) => {
    let fullPath = path_folder
      // fullPath = path.join(WORKING_DIRECTORY, path_folder);
    console.log('tools list files and folder : ', { path_folder })
    try {
      console.log(`List Folder & Sub Folder: ${fullPath}`);
      const folderExists = await fs.access(fullPath).then(() => true).catch(() => false);
      if (!folderExists) {
        const message = `anda belum memiliki folder atau file untuk dibaca silahkan buat filenya terlebih dahulu`;
        console.log(message);
        return message;
      }
      const readDirectoryRecursive = async (dir) => {
        const dirents = await fs.readdir(dir, { withFileTypes: true });
        const files = await Promise.all(dirents.map(async (dirent) => {
          const res = path.resolve(dir, dirent.name);
          if (dirent.isDirectory()) {
            return { name: dirent.name, type: 'folder', children: await readDirectoryRecursive(res) };
          } else {
            return { name: dirent.name, type: 'file' };
          }
        }));
        return files;
      };
      const fileList = await readDirectoryRecursive(fullPath);
      const message = `Berikut isi dari yang ada dalam folder: ${JSON.stringify(fileList, null, 2)}`
      console.log(message);
      return message;
    } catch (error) {
      const message = `Error: Gagal membaca isi folder ${fullPath}. ${error.message}`
      console.error(message);
      return message;
    }
  },
  {
    name: "list_files_and_folders",
    description: "Tools ini berfungsi untuk menampilkan struktur folder termasuk sub folder dan file yang ada di dalamnya",
    schema: z.object({
      path_folder: z.string().describe("Path Folder yang akan dibaca isinya"),
    }),
  }
);

const viewBladeTolls = tool(
  async ({ path_folder, file_name, new_line_code, start_line_number, update_mode, replaced_line }) => {
    console.log('tools code editor', { path_folder, file_name, new_line_code, start_line_number, update_mode, replaced_line })
    // const fullPath =  path.join(path_folder, file_name);
    const fullPath =  path.join(WORKING_DIRECTORY, path_folder, file_name);
    
    try {
      const content = await fs.readFile(fullPath, 'utf8');
      const lines = content.split('\n');

      if(!file_name){
        return `Saya membutuhkan nama file yang akan saya tulis codenya, Berikan saya nama filenya atau cek apakah ada file tersebut..? jika belum ada tolong buatkan dulu filenya oleh agen lain`
      }
      console.log({ path_folder, file_name, new_line_code, start_line_number, update_mode, replaced_line })

      if(!path_folder){
        return `Saya membutuhkan lokasi file yang akan saya tulis codenya, Berikan saya lokasi foldernya atau cek apakah ada file tersebut..? jika belum ada tolong buatkan dulu filenya oleh agen lain`
      }

      if(!new_line_code){
        return `baris code apa yang harus saya tambahkan, jangan lupa pilih update_mode apakah replace, insert, atau append..?`
      }
      if(update_mode == 'replace'){
        if(!replaced_line){
          return `Saya membutuhkan baris yang akan di replace atau dimodifikasi, Namun jika anda menginginkan menambahkan baris code mungkin update_mode append lebih cocok untuk ini, silahkan pastikan kembali terlebih dahulu`
        }
        // Ganti baris yang ditentukan dengan kode baru
        const updatedLines = lines.slice(0, replaced_line[0] - 1)
          .concat(new_line_code.split('\n'))
          .concat(lines.slice(replaced_line[replaced_line.length - 1]));
        
        // Tulis kembali file dengan konten yang diperbarui
        await fs.writeFile(fullPath, updatedLines, 'utf8');
        console.log(`Mode pembaruan: replace specified lines`);
        return `Baris kode berhasil diperbarui dari baris ${rangeReplace[0]} sampai ${rangeReplace[rangeReplace.length - 1]} di file ${file_name} di ${fullPath}`;
      }else if(update_mode == 'insert'){
        await fs.writeFile(fullPath, new_line_code, 'utf8');
        console.log(`Update mode: insert new code, replace all existing content`);
        return `All existing content replaced with new code in file ${file_name} at ${fullPath}`;
      }else if(update_mode == 'append'){
        if(!start_line_number){
          return `Baris kode tersebut harus di sisipkan pada baris code ke berapa..?`
        }
        const insertAt = start_line_number - 1; // Adjust for zero-based index
        const beforeNewCode = lines.slice(0, insertAt);
        const afterNewCode = lines.slice(insertAt);
        const updatedLines = beforeNewCode.concat(new_line_code.split('\n')).concat(afterNewCode);
        
        // Write back the file with the new code appended
        await fs.writeFile(fullPath, updatedLines, 'utf8');
        console.log(`Update mode: append new code starting at line ${start_line_number}`);
        return `New code appended starting at line ${start_line_number} in file ${file_name} at ${fullPath}`;

      }

    } catch (error) {
      console.error(`Silahkan pilih agen lain untuk membuat file terlebih dahulu dan kemabli kesini, Error: ${error.message}`);
      if (error.code === 'ENOENT') {
        return `Silahkan pilih agen lain untuk membuat file terlebih dahulu dan kemabli kesini, , Error: File ${file_name} tidak ditemukan di ${fullPath}`;
      }
      return `Silahkan pilih agen lain untuk membuat file terlebih dahulu dan kemabli kesini, , Error: Gagal mengedit file ${file_name} di ${fullPath}. ${error.message}`;
    }
  },
  {
    name: "view_blade_code_writer",
    description: "Panggil tools ini untuk mengedit, menulis, atau memperbarui code view atau tampilan blade laravel.",
    schema: z.object({
      path_folder: z.string().describe("path folder lokasi file yang akan di edit isi filenya"),
      file_name: z.string().describe("nama file yang akan di edit dan ditulis code programnya"),
      new_line_code: z.string().describe('Baris kode yang akan dimasukkan atau digunakan untuk memperbarui'),
      start_line_number: z.number().optional().describe('Nomor baris tempat kode baru akan disisipkan'),
      update_mode: z.enum(['insert', 'replace', 'append']).optional().describe('"replace" digunakan untuk mereplace baris code pada range line tertentu, "insert" untuk menulis kode dari awal from strach, "append" untuk menyisipkan kode pada baris tertentu'),
      replaced_line: z.array(z.number()).describe('Range baris yang akan di replace bagian codenya, misalnya [1,2,3,4,5] menandakan range 1 - 5')
    }),
  }
);

// const codeReaderTools = tool(
//   async ({ path_folder, file_name }) => {
//     console.log('tools code reader', { path_folder, file_name })
//     const fullPath =  path.join(WORKING_DIRECTORY, path_folder, file_name);
    
//     try {
//       const content = await fs.readFile(fullPath, 'utf8');
//       let listContent = content.split('\n');
//       listContent = listContent.map((line, index) => `${index + 1} ` + line);
//       console.log(`Berikut adalah isi dari file ${fullPath}${file_name} : 
//       ${listContent}`)
//       return `Berikut adalah isi dari file ${fullPath}${file_name} : 
//       ${listContent}`

//     } catch (error) {
//       console.error(`Silahkan pilih agen lain untuk membuat file terlebih dahulu dan kemabli kesini, Error: ${error.message}`);
//       if (error.code === 'ENOENT') {
//         return `Silahkan pilih agen lain untuk membuat file terlebih dahulu dan kemabli kesini, , Error: File ${file_name} tidak ditemukan di ${fullPath}`;
//       }
//       return `Silahkan pilih agen lain untuk membuat file terlebih dahulu dan kemabli kesini, , Error: Gagal mengedit file ${file_name} di ${fullPath}. ${error.message}`;
//     }
//   },
//   {
//     name: "code_reader",
//     description: "Panggil tools ini untuk Membaca isi file beserta baris atau line codenya pada []",
//     schema: z.object({
//       path_folder: z.string().describe("path folder lokasi file yang akan dibaca isi filenya"),
//       file_name: z.string().describe("nama file yang akan di baca isinya"),
//     }),
//   }
// )

// Utils
const agentMessageModifier = (systemPrompt, tools, teamMembers) => {
  const toolNames = tools.map((t) => t.name).join(", ");
  const systemMsgStart = new SystemMessage(systemPrompt +
    `
    Bekerjalah secara mandiri sesuai dengan keahlian Anda, menggunakan alat, tools, atau fungsi yang tersedia. Jangan meminta klarifikasi. Anggota tim Anda yang lain (dan tim lain) akan berkolaborasi dengan Anda dengan keahlian mereka sendiri. Anda dipilih karena suatu alasan! Anda adalah salah satu anggota tim berikut:
     ${teamMembers.join(", ")}.`)
  const systemMsgEnd = new SystemMessage(`
    Supervisor instructions: 
    ${systemPrompt}

    Remember, you individually can only use these tools: ${toolNames}
    End if you have already completed the requested task or you need help from other team members or agents. Communicate the work completed.
    `);

  return (messages) => 
    [systemMsgStart, ...messages, systemMsgEnd];
}

async function runAgentNode(params) {
  const { state, agent, name, config } = params;
  const result = await agent.invoke(state, config);
  const lastMessage = result.messages[result.messages.length - 1];
  return {
    messages: [new HumanMessage({ content: lastMessage.content, name })],
  };
}

async function createTeamSupervisor(llm, systemPrompt, members) {
  const options = ["FINISH", ...members];
  const routeTool = {
    name: "route",
    description: "Select the next role.",
    schema: z.object({
      reasoning: z.string(),
      next: z.enum(["FINISH", ...members]),
      instructions: z.string().describe("The specific instructions of the sub-task the next role should accomplish."),
    })
  }
  let prompt = ChatPromptTemplate.fromMessages([
    ["system", systemPrompt],
    new MessagesPlaceholder("messages"),
    [
      "system",
      "Given the conversation above, who should act next? Or should we FINISH? Select one of: {options}",
    ],
  ]);
  prompt = await prompt.partial({
    options: options.join(", "),
    team_members: members.join(", "),
  });

  const supervisor = prompt
    .pipe(
      llm.bindTools([routeTool], {
        tool_choice: "route",
      }),
    )
    .pipe(new JsonOutputToolsParser())
    // select the first one
    .pipe((x) => ({
      next: x[0].args.next,
      instructions: x[0].args.instructions,
    }));

  return supervisor;
}

const run = async ()=>{
    const TeamState = Annotation.Root({
      messages: Annotation({
        reducer: (x, y) => x.concat(y),
      }),
      team_members: Annotation({
        reducer: (x, y) => x.concat(y),
      }),
      next: Annotation({
        reducer: (x, y) => y ?? x,
        default: () => "supervisor",
      }),
      instructions: Annotation({
        reducer: (x, y) => y ?? x,
        default: () => "Solve the human's question.",
      }),
      controller_path: Annotation({
        reducer: (x, y) => [...new Set([...x, ...y])], // Menggabungkan dan menghilangkan duplikat
        default: () => [],
      }),
      view_path: Annotation({
        reducer: (x, y) => [...new Set([...x, ...y])], // Menggabungkan dan menghilangkan duplikat
        default: () => [],
      }),
      route_path: Annotation({
        reducer: (x, y) => [...new Set([...x, ...y])], // Menggabungkan dan menghilangkan duplikat
        default: () => [],
      }),
      model_path: Annotation({
        reducer: (x, y) => [...new Set([...x, ...y])], // Menggabungkan dan menghilangkan duplikat
        default: () => [],
      }),
    })
    
    const llm = new ChatOpenAI({ 
      modelName: "gpt-4o-mini",
      apiKey:  process.env.OPENAI_API_KEY,
    });
    
    const creatorFileNode = async (state, config) => {
      console.log('Ini adalah state', state)
      const messageModifier = agentMessageModifier(
        `Anda adalah seorang web developer laravel yang handal bertugas untuk membuat struktur file yang dibutuhkan untuk membuat program dan melanjutkan project laravel yang sudah ada.
        Anda hanya bertugas untuk membuat file dalam folder laravel.
        1. app/Models/[...write new models], 
        2. resources/views/[...write new views],
        2. app/Http/Controllers/[...write new controllers],
        3. routes/routechunks/[...write new route]
        Setiap program baru harus disimpan kedalam sub folder sesuai dengan nama programnya contoh "app/Models/LandingPage/LandingPage.php", Anda harus pastikan bahwa tidak ada file duplikat, Anda diperbolehkan untuk membuat lebih dari satu file dalam project misal "resources/views/index.php", "resources/views/edit.php", "resources/views/store.php" mencakup semua page untuk program CRUD dan lain lain, anda juga di perbolehkan untuk menggunakan  directive Blade seperti @include dan lain lain.
        Anda harus memberi tahu tim lain untuk menulis code pada file yang telah kamu buat, jadi anda harus menyertakan path file dalam response.`,
        [creatorFile],
        state.team_members ?? ["creator_file"],
      )
      // const model = llm.withStructuredOutput(creatorFileResponse);
      const creatorFileAgent = createReactAgent({
        llm,
        tools: [creatorFile, listFilesAndFolders],
        messageModifier,
      })

      let structuredFolder = z
      .object({
        model_path: z.array(z.string()).describe("Path file new model"),
        route_path: z.array(z.string()).describe("Path file new routes"),
        view_path: z.array(z.string()).describe("Path file new views"),
        controller_path: z.array(z.string()).describe("Path file new Controllers"),

      })
      .describe("Daftar path folder.");
      const parser = StructuredOutputParser.fromZodSchema(structuredFolder);
      const prompt = ChatPromptTemplate.fromMessages([
        [
          "system",
          "Ubah text dibawah menjadi format json berikut `json` tags\n{format_instructions}",
        ],
        ["human", "{query}"],
      ]);
      const partialedPrompt = await prompt.partial({
        format_instructions: parser.getFormatInstructions(),
      });
      

        const response = await runAgentNode({ 
          state, 
          agent: creatorFileAgent, 
          name: "CreatorFile", 
          config 
        });
        const chain = partialedPrompt.pipe(llm).pipe(parser);
        const result = await chain.invoke({ query : response.messages[0].content });
        
        state.model_path = result.model_path;
        state.route_path = result.route_path;
        state.view_path = result.view_path;
        state.controller_path = result.controller_path;

        // console.log(result)
        return response;
    };

    const codeWriterNode = (state, config) => {
      const messageModifier = agentMessageModifier(
        `Anda adalah seorang web developer handal yang bertugas untuk menulis kode pada path file yang diberikan, anda harus mengetahui file mana yang akan kamu edit atau tulis, jika belum ada file yang dimaksud minta dulu agen lain untuk membuatnya., gunakan tech stack HTML, CSS, Javascript dan bootstrap anda dapat menulis dari awal semua kode, update kode, atau menyisipkan kode baru, saat ini anda berada di relative path folder ./ggi-is 
        Buatlah Model, View, Controller, Route untuk membangun sebuah project laravel, Berikut file yang berhasil dibuat oleh tim lain : 
        - models : ${state.model_path}
        - controllers : ${state.controller_path}
        - routes : ${state.route_path}
        - views : ${state.view_path}
        `,
        [viewBladeTolls, listFilesAndFolders],
        state.team_members ?? ["CodeWriter"],
      )
      const codeWriterAgent = createReactAgent({
        llm,
        tools: [viewBladeTolls, listFilesAndFolders],
        messageModifier,
      })
      return runAgentNode({ state, agent: codeWriterAgent, name: "CodeWriter", config });
    }

    const supervisorAgent = await createTeamSupervisor(
      llm,
      `Anda adalah seorang supervisor web developer laravel handal yang bertugas mengelola percakapan antara pekerja berikut untuk membuat program CRUD.
      {team_members}. 
      Berdasarkan permintaan pengguna berikut, respon dengan pekerja yang akan bertindak selanjutnya. Setiap pekerja akan melakukan tugas dan merespon dengan hasil dan status mereka.
      
      When finished, respond with FINISH.
      Select strategically to minimize the number of steps taken.`,
      ["CreatorFile", "CodeWriter"],
    );
    
    
    const directoryGraph = new StateGraph(TeamState)
      .addNode("CreatorFile", creatorFileNode)
      .addNode("CodeWriter", codeWriterNode)
      .addNode("supervisor", supervisorAgent)

      .addEdge("CreatorFile", "supervisor")
      .addEdge("CodeWriter", "supervisor")
      
      .addConditionalEdges("supervisor", (x) => x.next, {
        CreatorFile: "CreatorFile",
        CodeWriter: "CodeWriter",
        FINISH: END,
      })
      .addEdge(START, "supervisor");
    
      const checkpointer  = new MemorySaver();
      config = { configurable: { thread_id: "2" } };

    const directoryChain = directoryGraph.compile({checkpointer });
    const streamResults = directoryChain.stream(
      {
        messages: [new HumanMessage("Buat sebuah program crud data HedonApps menggunakan laravel, sebelumnya saya memiliki kolom id, nama, alamat buat tampilannya menggunakan bootstrap")],
      },
      { 
        ...config,
        recursionLimit: 100 
      },
    );
    for await (const output of await streamResults) {
      if (!output?.__end__) {
        console.log(output);
        console.log("----");
      }
    }
}

run()
