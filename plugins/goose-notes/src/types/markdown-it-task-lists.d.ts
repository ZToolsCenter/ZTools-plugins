declare module 'markdown-it-task-lists' {
    import MarkdownIt = require('markdown-it');
    const taskLists: (md: MarkdownIt, options?: any) => void;
    export = taskLists;
}
