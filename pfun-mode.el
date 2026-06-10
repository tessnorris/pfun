;;; pfun-mode.el --- Major mode for the Pfun language -*- lexical-binding: t -*-

;; Author: Pfun Language
;; Version: 1.0.0
;; Keywords: languages pfun
;; License: MIT

;;; Commentary:
;; Provides syntax highlighting, comment handling, and indentation
;; support for the Pfun procedural-functional language (.pf files).

;;; Code:

;; ─── Keyword lists ────────────────────────────────────────────────────────────

(defconst pfun-keywords-let
  '("let"))

(defconst pfun-keywords-var
  '("var"))

(defconst pfun-keywords-function
  '("function" "fn"))

(defconst pfun-keywords-proc
  '("proc"))

(defconst pfun-keywords-type
  '("type"))

(defconst pfun-keywords-control
  '("if" "then" "else" "return"))

(defconst pfun-keywords-match
  '("match" "where"))

(defconst pfun-keywords-comprehension
  '("for"))

(defconst pfun-keywords-module
  '("import" "export" "from" "as"))

(defconst pfun-keywords-other
  '("eval" "dict"))

(defconst pfun-keywords-bool
  '("true" "false"))

(defconst pfun-keywords-option
  '("Some" "None"))

(defconst pfun-builtins-list
  '("head" "tail" "cons" "map" "filter" "reduce" "take" "slice" "nth"))

(defconst pfun-builtins-lazy
  '("iterate" "repeat" "cycle" "isInfinite"))

(defconst pfun-builtins-search
  '("find" "findSlice"))

(defconst pfun-builtins-string
  '("asc" "chr"))

(defconst pfun-builtins-dict
  '("has" "remove" "keys" "values"))

(defconst pfun-builtins-io
  '("print" "println" "printf" "readChar" "readln" "readFile"
    "writeFile" "fileOpen" "fileClose" "readLine" "writeLine" "writeChar"))

;; ─── Faces ────────────────────────────────────────────────────────────────────

(defface pfun-face-let
  '((t :inherit font-lock-keyword-face))
  "Face for `let' bindings.")

(defface pfun-face-var
  '((t :inherit font-lock-variable-name-face))
  "Face for `var' bindings.")

(defface pfun-face-function
  '((t :inherit font-lock-keyword-face))
  "Face for function definition keywords.")

(defface pfun-face-proc
  '((t :inherit font-lock-preprocessor-face))
  "Face for `proc' keyword.")

(defface pfun-face-type
  '((t :inherit font-lock-type-face))
  "Face for type keywords.")

(defface pfun-face-control
  '((t :inherit font-lock-keyword-face))
  "Face for control flow keywords.")

(defface pfun-face-module
  '((t :inherit font-lock-preprocessor-face))
  "Face for module keywords.")

(defface pfun-face-bool
  '((t :inherit font-lock-constant-face))
  "Face for boolean literals.")

(defface pfun-face-option
  '((t :inherit font-lock-constant-face))
  "Face for Option constructors.")

(defface pfun-face-builtin-list
  '((t :inherit font-lock-builtin-face))
  "Face for list builtins.")

(defface pfun-face-builtin-lazy
  '((t :inherit font-lock-builtin-face :slant italic))
  "Face for lazy/infinite list builtins.")

(defface pfun-face-builtin-search
  '((t :inherit font-lock-function-name-face))
  "Face for search builtins.")

(defface pfun-face-builtin-string
  '((t :inherit font-lock-function-name-face))
  "Face for string builtins.")

(defface pfun-face-builtin-dict
  '((t :inherit font-lock-builtin-face))
  "Face for dict builtins.")

(defface pfun-face-builtin-io
  '((t :inherit font-lock-warning-face))
  "Face for I/O builtins (procedures only).")

(defface pfun-face-operator
  '((t :inherit font-lock-operator-face))
  "Face for operators.")

(defface pfun-face-wildcard
  '((t :inherit font-lock-constant-face :weight bold))
  "Face for the wildcard `_'.")

;; ─── Font-lock rules ──────────────────────────────────────────────────────────

(defun pfun--keyword-regexp (words)
  "Build a word-boundary regexp matching any word in WORDS."
  (concat "\\_<" (regexp-opt words t) "\\_>"))

(defconst pfun-font-lock-keywords
  `(
    ;; I/O builtins — must come before other builtins (warning face)
    (,(pfun--keyword-regexp pfun-builtins-io)       . 'pfun-face-builtin-io)

    ;; Other builtins
    (,(pfun--keyword-regexp pfun-builtins-list)     . 'pfun-face-builtin-list)
    (,(pfun--keyword-regexp pfun-builtins-lazy)     . 'pfun-face-builtin-lazy)
    (,(pfun--keyword-regexp pfun-builtins-search)   . 'pfun-face-builtin-search)
    (,(pfun--keyword-regexp pfun-builtins-string)   . 'pfun-face-builtin-string)
    (,(pfun--keyword-regexp pfun-builtins-dict)     . 'pfun-face-builtin-dict)

    ;; Keywords
    (,(pfun--keyword-regexp pfun-keywords-let)          . 'pfun-face-let)
    (,(pfun--keyword-regexp pfun-keywords-var)          . 'pfun-face-var)
    (,(pfun--keyword-regexp pfun-keywords-function)     . 'pfun-face-function)
    (,(pfun--keyword-regexp pfun-keywords-proc)         . 'pfun-face-proc)
    (,(pfun--keyword-regexp pfun-keywords-type)         . 'pfun-face-type)
    (,(pfun--keyword-regexp pfun-keywords-control)      . 'pfun-face-control)
    (,(pfun--keyword-regexp pfun-keywords-match)        . 'pfun-face-control)
    (,(pfun--keyword-regexp pfun-keywords-comprehension). 'pfun-face-control)
    (,(pfun--keyword-regexp pfun-keywords-module)       . 'pfun-face-module)
    (,(pfun--keyword-regexp pfun-keywords-other)        . 'pfun-face-module)
    (,(pfun--keyword-regexp pfun-keywords-bool)         . 'pfun-face-bool)
    (,(pfun--keyword-regexp pfun-keywords-option)       . 'pfun-face-option)

    ;; Wildcard _ (standalone, not part of an identifier)
    ("\\(?:^\\|[^A-Za-z0-9_]\\)\\(_\\)\\(?:[^A-Za-z0-9_]\\|$\\)"
     (1 'pfun-face-wildcard))

    ;; Operators: => -> <- == != <= >= && || ! ? + - * / % = < >
    (,(rx (or "=>" "->" "<-" "==" "!=" "<=" ">=" "&&" "||"
              (any "!?+*/%<>=") (: "-" (not (any ">")))))
     . 'pfun-face-operator))
  "Font-lock keywords for `pfun-mode'.")

;; ─── Syntax table ────────────────────────────────────────────────────────────

(defvar pfun-mode-syntax-table
  (let ((st (make-syntax-table)))
    ;; // line comments
    (modify-syntax-entry ?/ ". 124b" st)
    (modify-syntax-entry ?* ". 23"   st)
    (modify-syntax-entry ?\n "> b"   st)
    ;; Strings
    (modify-syntax-entry ?\" "\"" st)
    ;; Char literals
    (modify-syntax-entry ?' "\"" st)
    ;; Brackets
    (modify-syntax-entry ?\( "()" st)
    (modify-syntax-entry ?\) ")(" st)
    (modify-syntax-entry ?\[ "(]" st)
    (modify-syntax-entry ?\] ")[" st)
    (modify-syntax-entry ?\{ "(}" st)
    (modify-syntax-entry ?\} "){" st)
    ;; Underscore is part of identifiers
    (modify-syntax-entry ?_ "w" st)
    st)
  "Syntax table for `pfun-mode'.")

;; ─── Indentation ─────────────────────────────────────────────────────────────

(defcustom pfun-indent-offset 2
  "Number of spaces per indentation level in `pfun-mode'."
  :type 'integer
  :group 'pfun)

(defun pfun-indent-line ()
  "Indent the current line for `pfun-mode'."
  (interactive)
  (let ((indent (pfun--calculate-indent)))
    (when indent
      (if (<= (current-column) (current-indentation))
          (indent-line-to indent)
        (save-excursion (indent-line-to indent))))))

(defun pfun--calculate-indent ()
  "Return the appropriate indentation for the current line."
  (save-excursion
    (beginning-of-line)
    (let ((current-line-closes (looking-at "[ \t]*[}\\]]")))
      (condition-case nil
          (progn
            (backward-up-list)
            (let ((base (current-indentation)))
              (if current-line-closes
                  base
                (+ base pfun-indent-offset))))
        (error 0)))))

;; ─── Mode definition ─────────────────────────────────────────────────────────

;;;###autoload
(define-derived-mode pfun-mode prog-mode "Pfun"
  "Major mode for editing Pfun (.pf) source files.

Provides syntax highlighting for keywords, builtins, operators,
strings, char literals, and comments."
  :syntax-table pfun-mode-syntax-table

  (setq-local font-lock-defaults '(pfun-font-lock-keywords))
  (setq-local comment-start "// ")
  (setq-local comment-end "")
  (setq-local comment-start-skip "//+\\s-*")
  (setq-local indent-line-function #'pfun-indent-line)
  (setq-local tab-width pfun-indent-offset))

;;;###autoload
(add-to-list 'auto-mode-alist '("\\.pf\\'" . pfun-mode))

(provide 'pfun-mode)
;;; pfun-mode.el ends here
