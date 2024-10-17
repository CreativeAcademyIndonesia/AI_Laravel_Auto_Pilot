const { z } = require("zod");
const fs = require("fs/promises");
const path = require("path");
const { END, START, StateGraph } = require("@langchain/langgraph");
const { tool } = require("@langchain/core/tools");

const { DynamicStructuredTool  } = require("@langchain/core/tools")

const { HumanMessage, BaseMessage, SystemMessage } = require("@langchain/core/messages");
const { ChatPromptTemplate, MessagesPlaceholder } = require("@langchain/core/prompts");
const { JsonOutputToolsParser } = require("langchain/output_parsers");
const { ChatOpenAI } = require("@langchain/openai");
const { Runnable } = require("@langchain/core/runnables");

const { Annotation } = require("@langchain/langgraph");
const { createReactAgent } = require("@langchain/langgraph/prebuilt");


const { RunnableLambda } = require("@langchain/core/runnables");


const folderRoute = "D:\\copilot\\workspace";

// Tools List
const creatorFile = tool(
  async ({ path_folder, file_name }) => {
    const fullPath = path.join(folderRoute, path_folder, file_name);
    try {
      console.log(`Membuat direktori: ${path.dirname(fullPath)}`);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      console.log(`Menulis file: ${fullPath}`);
      await fs.writeFile(fullPath, "", "utf8");
      console.log(`File ${file_name} berhasil dibuat di ${fullPath}`);
      return `File ${file_name} berhasil dibuat di ${fullPath}`;
    } catch (error) {
      console.error(`Error: Gagal membuat file ${file_name} di ${fullPath}. ${error.message}`);
      return `Error: Gagal membuat file ${file_name} di ${fullPath}. ${error.message}`;
    }
  },
  {
    name: "creator_file",
    description: "Tools ini berfungsi untuk membuat sebuah file",
    schema: z.object({
      path_folder: z.string().describe("Path Folder untuk menyimpan file"),
      file_name: z.string().describe("Nama file yang akan dibuat"),
    }),
  }
);
const listFilesAndFolders = tool(
  async ({ path_folder }) => {
    const fullPath = path.join(folderRoute, path_folder);
    try {
      console.log(`Membaca isi folder: ${fullPath}`);
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
      console.log(`Berikut isi file dan folder saat ini: ${JSON.stringify(fileList, null, 2)}`);
      return `Berikut isi file dan folder saat ini: ${JSON.stringify(fileList, null, 2)}`;
    } catch (error) {
      console.error(`Error: Gagal membaca isi folder ${fullPath}. ${error.message}`);
      return `Error: Gagal membaca isi folder ${fullPath}. ${error.message}`;
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
const viewWriter = tool(
  async ({ path_folder, file_name, new_line_code, line_number, update_mode }) => {
    const fullPath =  path.join(folderRoute, path_folder, file_name);
    
    try {
      // Baca isi file
      const content = await fs.readFile(fullPath, 'utf8');
      console.log(`Isi file: ${content}`);
      const lines = content.split('\n');
      console.log(`Baris file: ${lines}`);
      
      if (line_number) {
        console.log(`Nomor baris: ${line_number}`);
        if (update_mode === 'replace' && line_number <= lines.length) {
          // Ganti baris yang ada dengan kode baru
          console.log(`Mode pembaruan: replace`);
          lines[line_number - 1] = new_line_code;
        } else {
          // Sisipkan kode baru pada baris yang ditentukan
          console.log(`Mode pembaruan: insert`);
          lines.splice(line_number - 1, 0, new_line_code);
        }
        
        // Tulis kembali file dengan konten yang diperbarui
        await fs.writeFile(fullPath, lines.join('\n'), 'utf8');
        const action = update_mode === 'replace' ? 'diperbarui' : 'disisipkan';
        console.log(`Aksi: ${action}`);
        return `Baris kode berhasil ${action} pada baris ${line_number} di file ${file_name} di ${fullPath}`;
      } else {
        // Jika line_number tidak ditentukan, tambahkan kode di akhir file
        console.log(`Menambahkan kode di akhir file`);
        await fs.appendFile(fullPath, '\n' + new_line_code, "utf8");
        return `Baris kode berhasil ditambahkan di akhir file ${file_name} di ${fullPath}`;
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
    name: "view_code_writer",
    description: "Panggil tools ini untuk mengedit, menulis, atau memperbarui code menggunakan HTML, javascript",
    schema: z.object({
      path_folder: z.string().describe("path folder lokasi file yang akan di edit isi filenya"),
      file_name: z.string().describe("nama file yang akan di edit dan ditulis code programnya"),
      new_line_code: z.string().describe('Baris kode yang akan dimasukkan atau digunakan untuk memperbarui'),
      line_number: z.number().optional().describe('Nomor baris tempat kode baru akan disisipkan atau diperbarui (opsional)'),
      update_mode: z.enum(['insert', 'replace']).optional().describe('Mode pembaruan: "insert" untuk menyisipkan, "replace" untuk mengganti baris yang ada')
    }),
  }
);
const WORKING_DIRECTORY = "./workspace/temp";
fs.mkdir(WORKING_DIRECTORY, { recursive: true });
const createOutlineTool = tool(
    async ({ points, file_name }) => {
        const filePath = path.join(WORKING_DIRECTORY, file_name);
        const data = points
        .map((point, index) => `${index + 1}. ${point}\n`)
        .join("");
        await fs.writeFile(filePath, data);
        return `Outline saved to ${file_name}`;
    },
    {
        name: "create_outline",
        description: "Create and save an outline.",
        schema: z.object({
            points: z
                .array(z.string())
                .nonempty("List of main points or sections must not be empty."),
            file_name: z.string(),
        }),
    }
);
// Utils
const agentMessageModifier = (systemPrompt, tools, teamMembers) => {
  const toolNames = tools.map((t) => t.name).join(", ");
  const systemMsgStart = new SystemMessage(systemPrompt +
    `
    Work autonomously according to your specialty, using the tools available to you.
    Do not ask for clarification. Your other team members (and other teams) will collaborate with you with their own specialties.
    You are chosen for a reason! You are one of the following team members: ${teamMembers.join(", ")}.`)
  const systemMsgEnd = new SystemMessage(`Supervisor instructions: ${systemPrompt}\n` +
      `Remember, you individually can only use these tools: ${toolNames}
      
      End if you have already completed the requested task. Communicate the work completed.`);
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
    const DirectoryTeamState = Annotation.Root({
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
    })
    
    const llm = new ChatOpenAI({ 
      modelName: "gpt-4o-mini",
    });
    
    const creatorFileNode = (state, config) => {
      const messageModifier = agentMessageModifier(
        "Kamu adalah assistant yang bertugas untuk membuat file yang dibutuhkan untuk membuat file yang dibutuhkan untuk membuat program",
        [creatorFile],
        state.team_members ?? ["creator_file"],
      )
      const creatorFileAgent = createReactAgent({
        llm,
        tools: [creatorFile],
        messageModifier,
      })
      return runAgentNode({ state, agent: creatorFileAgent, name: "CreatorFile", config });
    };

    const ListFolderNode = (state, config) => {
        const messageModifier = agentMessageModifier(
          "Kamu adalah assistant yang bertugas untuk Mendapatkan struktur folder.",
          [listFilesAndFolders],
          state.team_members ?? ["ListFolder"],
        )
        const ListFolderAgent = createReactAgent({
          llm,
          tools: [listFilesAndFolders],
          messageModifier,
        })
        return runAgentNode({ state, agent: ListFolderAgent, name: "ListFolder", config });
      }
    
    const supervisorAgent = await createTeamSupervisor(
      llm,
      "You are a supervisor tasked with managing a conversation between the" +
        " following workers:  {team_members}. Given the following user request," +
        " respond with the worker to act next. Each worker will perform a" +
        " task and respond with their results and status. When finished," +
        " respond with FINISH.\n\n" +
        " Select strategically to minimize the number of steps taken.",
      ["CreatorFile", "ListFolder"],
    );
    
    
    const directoryGraph = new StateGraph(DirectoryTeamState)
      .addNode("CreatorFile", creatorFileNode)
      .addNode("supervisor", supervisorAgent)
      .addNode("ListFolder", ListFolderNode)
      // Define the control flow
      .addEdge("CreatorFile", "supervisor")
      .addEdge("ListFolder", "supervisor")
      .addConditionalEdges("supervisor", (x) => x.next, {
        CreatorFile: "CreatorFile",
        ListFolder: "ListFolder",
        FINISH: END,
      })
      .addEdge(START, "supervisor");
    
    const directoryChain = directoryGraph.compile();
    // const streamResults = directoryChain.stream(
    //   {
    //     messages: [new HumanMessage("Buatkan saya sebuah file untuk membuat halaman web landing page, namun jika landing_page.html sudah ada buat file dengan nama yang lain")],
    //   },
    //   { recursionLimit: 100 },
    // );
    // for await (const output of await streamResults) {
    //   if (!output?.__end__) {
    //     console.log(output);
    //     console.log("----");
    //   }
    // }
        
    // const codeWriterNode = (state, config) => {
    //   const messageModifier = agentMessageModifier(
    //     "Kamu adalah assistant yang bertugas untuk menulis kode pada path file yang diberikan, jika belum ada file yang dimaksud minta dulu agen lain untuk membuatnya., gunakan tech stack HTML, CSS, Javascript dan bootstrap",
    //     [viewWriter],
    //     state.team_members ?? ["CodeWriter"],
    //   )
    //   const codeWriterAgent = createReactAgent({
    //     llm,
    //     tools: [viewWriter],
    //     messageModifier,
    //   })
    //   return runAgentNode({ state, agent: codeWriterAgent, name: "CodeWriter", config });
    // }


    const prelude = new RunnableLambda({
        func: async (state) => {
            let writtenFiles = [];
            if (
            !(await fs
                .stat(WORKING_DIRECTORY)
                .then(() => true)
                .catch(() => false))
            ) {
            await fs.mkdir(WORKING_DIRECTORY, { recursive: true });
            }
            try {
            const files = await fs.readdir(WORKING_DIRECTORY);
            for (const file of files) {
                writtenFiles.push(file);
            }
            } catch (error) {
            console.error(error);
            }
            const filesList = writtenFiles.length > 0
            ? "\nBerikut adalah file yang telah ditulis tim Anda ke direktori:\n" +
                writtenFiles.map((f) => ` - ${f}`).join("\n")
            : "Tidak ada file yang ditulis.";
            return { ...state, current_files: filesList };
        },  
    });

      const DocWritingState = Annotation.Root({
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
        current_files: Annotation({
          reducer: (x, y) => (y ? `${x}\n${y}` : x),
          default: () => "No files written.",
        }),
        instructions: Annotation({
          reducer: (x, y) => y ?? x,
          default: () => "Solve the human's question.",
        }),
      })

    const docWritingLlm = new ChatOpenAI({ modelName: "gpt-4o-mini" });

    const docWritingNode = (state, config) => {
        const messageModifier = agentMessageModifier(
            `You are an expert writing a research document.\nBelow are files currently in your directory:\n${state.current_files}`,
            [writeDocumentTool, editDocumentTool, readDocumentTool],
            state.team_members ?? [],
        )
        const docWriterAgent = createReactAgent({
            llm: docWritingLlm,
            tools: [writeDocumentTool, editDocumentTool, readDocumentTool],
            messageModifier,
        })
        const contextAwareDocWriterAgent = prelude.pipe(docWriterAgent);
        return runAgentNode({ state, agent: contextAwareDocWriterAgent, name: "DocWriter", config });
    }

    const codeWriterNode = (state, config) => {
        const messageModifier = agentMessageModifier(
            `Kamu adalah expert web programer yang bertugas utuk menulis kode pada path yang diberikan , jika belum ada file yang dimaksud minta dulu agen lain untuk membuatnya., gunakan tech stack HTML, CSS, Javascript dan bootstrap`,
            [viewWriter],
            state.team_members ?? ["CodeWriter"],
        )
        const codeWriterAgent = createReactAgent({
            llm,
            tools: [viewWriter],
            messageModifier,
        })
        return runAgentNode({ state, agent: codeWriterAgent, name: "codeWriter", config });
    }

    const noteTakingNode = (state, config) => {
        const messageModifier = agentMessageModifier(
            "Kamu adalah programer web senior ahli yang ditugaskan untuk menulis kerangka makalah dan" +
            ` taking notes to craft a perfect paper. ${state.current_files}`,
            [createOutlineTool],
            state.team_members ?? [],
        )
        const noteTakingAgent = createReactAgent({
            llm: docWritingLlm,
            tools: [createOutlineTool],
            messageModifier,
        })
        const contextAwareNoteTakingAgent = prelude.pipe(noteTakingAgent);
        return runAgentNode({ state, agent: contextAwareNoteTakingAgent, name: "NoteTaker", config });
    }

    const programmerMember = ["CodeWriter", "NoteTaker"];
    const docWritingSupervisor = await createTeamSupervisor(
        docWritingLlm,
        "You are a supervisor tasked with managing a conversation between the" +
            " following workers:  {team_members}. Given the following user request," +
            " respond with the worker to act next. Each worker will perform a" +
            " task and respond with their results and status. When finished," +
            " respond with FINISH.\n\n" +
            " Select strategically to minimize the number of steps taken.",
        programmerMember,
    );

    const authoringGraph = new StateGraph(DocWritingState)
//   .addNode("DocWriter", docWritingNode)
  .addNode("NoteTaker", noteTakingNode)
  .addNode("CodeWriter", codeWriterNode)
  .addNode("supervisor", docWritingSupervisor)
  // Tambahkan edge yang selalu terjadi
  .addEdge("CodeWriter", "supervisor")
  .addEdge("NoteTaker", "supervisor")
//   .addEdge("ChartGenerator", "supervisor")
  // Tambahkan edge di mana routing berlaku
  .addConditionalEdges("supervisor", (x) => x.next, {
    CodeWriter: "CodeWriter",
    NoteTaker: "NoteTaker",
    // ChartGenerator: "ChartGenerator",
    FINISH: END,
  })
  .addEdge(START, "supervisor");

const CodeWriterChain = RunnableLambda.from(
  ({ messages }) => {
    return {
      messages: messages,
      team_members: ["Code Writer", "Note Taker"],
    };
  },
);
const CodeWriterChains = CodeWriterChain.pipe(authoringGraph.compile());
// let resultStream = authoringChain.stream(
//     {
//       messages: [
//         new HumanMessage(
//           "buatkan saya kode html pada file landing_page.html.",
//         ),
//       ],
//     },
//     { recursionLimit: 100 },
//   );
  
//   for await (const step of await resultStream) {
//     if (!step?.__end__) {
//       console.log(step);
//       console.log("---");
//     }
//   }


// Define the top-level State interface
const State = Annotation.Root({
    messages: Annotation({
      reducer: (x, y) => x.concat(y),
    }),
    next: Annotation({
      reducer: (x, y) => y ?? x,
      default: () => "DirectoryTeam",
    }),
    instructions: Annotation({
      reducer: (x, y) => y ?? x,
      default: () => "Resolve the user's request.",
    }),
  });
  
  const supervisorNode = await createTeamSupervisor(
    llm,
    "You are a supervisor tasked with managing a conversation between the, Anda bisa mulai dengan membuat file terlebih dahulu, lalu anda bisa melakukan check daftar file folder yang ada sebelum menulis outline dan mulai untuk menulis kodenya." +
      " following teams: {team_members}. Given the following user request," +
      " respond with the worker to act next. Each worker will perform a" +
      " task and respond with their results and status. When finished," +
      " respond with FINISH.\n\n" +
      " Select strategically to minimize the number of steps taken.",
    ["DirectoryTeam", "CodeWritingTeam"],
  );
  
  const getMessages = RunnableLambda.from((state) => {
    return { messages: state.messages };
  });
  
  const joinGraph = RunnableLambda.from((response) => {
    return {
      messages: [response.messages[response.messages.length - 1]],
    };
  });


  const superGraph = new StateGraph(State)
  .addNode("DirectoryTeam", getMessages.pipe(directoryChain).pipe(joinGraph))
  .addNode("CodeWritingTeam", getMessages.pipe(CodeWriterChains).pipe(joinGraph))
  .addNode("supervisor", supervisorNode)
  .addEdge("DirectoryTeam", "supervisor")
  .addEdge("CodeWritingTeam", "supervisor")
  .addConditionalEdges("supervisor", (x) => x.next, {
    CodeWritingTeam: "CodeWritingTeam",
    DirectoryTeam: "DirectoryTeam",
    FINISH: END,
  })
  .addEdge(START, "supervisor");

const compiledSuperGraph = superGraph.compile();

resultStream = compiledSuperGraph.stream(
    {
      messages: [
        new HumanMessage(
          "Buatkan saya landing page dengan fitur yang lengkap, anda bisa awali dengan membuat file dan projectnya lengkap dengan bootstrap, html, css, js",
        ),
      ],
    },
    { recursionLimit: 150 },
  );
  
  for await (const step of await resultStream) {
    if (!step.__end__) {
      console.log(step);
      console.log("---");
    }
  }

}

run()
