#${pythonVersion} app.py $([ ! -z "${serverAddress}" ] && echo --host ${serverAddress}) $([ ! -z "${portNumber}" ] && echo --port ${portNumber})
#${pythonVersion} -m streamlit run app.py --browser.gatherUsageStats false $([ ! -z "${serverAddress}" ] && echo --server.address ${serverAddress}) $([ ! -z "${portNumber}" ] && echo --server.port ${portNumber})
${pythonVersion} -m uvicorn server.main:app --reload $([ ! -z "${serverAddress}" ] && echo --host ${serverAddress}) $([ ! -z "${portNumber}" ] && echo --port ${portNumber})
#${pythonVersion} back.py
