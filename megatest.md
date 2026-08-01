# Markdown Test Page

Headings:
# Heading1
## Heading2
### Heading3
#### Heading4
##### Heading5
###### Heading6

special characters you'll need to escape: < > &

---
**NOTE:** this is a box
it's a great box
---

```
**NOTE:** this is a code box
i love code.   new lines are preserved
but you can also use *formatting* in here **too** _also_
```

>>>
**NOTE:** this is a blockquote box
you can have multiple lines in it.
>>>

}}}
**NOTE:** this is an invisible blockquote
can be used for indentation.
}}}

---
you can nest different box types...
```
...a code block
```
>>>
...a blockquote block.
>>>
```
...a really really really really really really really really really wide code block will side-scroll in narrow browsers (e.g. on mobile).
```
Unfortunately, we can't nest the same type of --- box inside itself (because it's hard to know what is meant!)
---

-+-
centered box
-+-

=+=
centered box (borderless)
=+=



> blockquote
>> blockquote2
>>> blockquote2
>>> blockquote44
>>> blockquote3
> blockquote
>> blockquote2    

} invisible blockquote
}} invisible blockquote2
}}} invisible blockquote2
}}} invisible blockquote44
}}} invisible blockquote3
} invisible blockquote
}} invisible blockquote2 (basically an indent)  

nested lists
 * my bullet.  BULLETS start with a (optional) <space> then a "*"
   0. each sub level needs 2 spaces indentation added...
   1. you can change the bullet type when you indent, also.
   2. my arabic (aka hindu) numbered bullets
     i. my roman numbered bullets i
     ii. my roman numbered bullets ii
     iii. my roman numbered bullets iii
       a. my english alphabet lowercase bullets a
       b. my english alphabet lowercase bullets b
       c. my english alphabet lowercase bullets c
         A. my english alphabet uppercase bullets A
         B. my english alphabet uppercase bullets B
           8. can begin at any 'number' in whatever numeric alphabet (except 'i') 8
           3. but, subsequent ones will auto-number (ignores your typed number on the 2-n ones) 3
             i. beginning with 'i' starts a roman numbered list, rather than "starting at 'i'" english alphabet list, sad but necessary. i
     iv. continuing from iii above iv
   3. continuing from 2 above, this one should be "3"
     i. new roman list i 
       * sub bullet *

---
 - box of bullets
   - box of bullets
 - box of bullets
   - box of bullets
. . . .
- a new grouping of bullets, now without leading space...
  - box of bullets
- box of bullets
  - box of bullets
---

## table

| Row 1, Col 1 | Row 1, Col 2 | Row 1, Col 3 |
| Row 2, Col 1 | Row 2, Col 2 | Row 2, Col 3 |


table with headings

| Header 1 | Header 2 | Header 3 |
|:---------|:--------:|---------:|
| Row 1, Col 1 | Row 1, Col 2 | Row 1, Col 3 |
| Row 2, Col 1 | Row 2, Col 2 | Row 2, Col 3 |


really wide tables should side-scroll in narrow browsers (e.g. mobile) 

| Header 1 | Header 2 | Header 3 | Header 4 | Header 5 | Header 6 | Header 1 | Header 2 | Header 3 | Header 4 | Header 5 | Header 6 |
|:---------|:--------:|---------:|:---------|:--------:|---------:|:---------|:--------:|---------:|:---------|:--------:|---------:|
| Row 1, Col 1 | Row 1, Col 2 | Row 1, Col 3 | Row 1, Col 4 | Row 1, Col 5 | Row 1, Col 6 | Row 1, Col 1 | Row 1, Col 2 | Row 1, Col 3 | Row 1, Col 4 | Row 1, Col 5 | Row 1, Col 6 |
| Row 2, Col 1 | Row 2, Col 2 | Row 2, Col 3 | Row 2, Col 4 | Row 2, Col 5 | Row 2, Col 6 | Row 2, Col 1 | Row 2, Col 2 | Row 2, Col 3 | Row 2, Col 4 | Row 2, Col 5 | Row 2, Col 6 |


links
 * Naked Link: https://example.com
 * [Link to wiki topic](Pharmakon)
 * [Link to wiki topic: search](Pharmakon?searchterm=frank)
 * [Link to wiki topic: heading](Pharmakon#Recipes)
 * [Link to wiki topic: search + heading](Pharmakon?searchterm=Kykeon#Recipes)
 * [Link to local page: heading](#table)
 * [Link to local page: search](?searchterm=Header)
 * [Link to local page: search + heading](?searchterm=Header#table)
 * [Link to URL](https://example.com)
 * [Link to absolute path](/wiki/view/markdown test) 
 * [Link to absolute path: heading](/wiki/view/markdown test#table)
 * [Link to absolute path: search](/wiki/view/markdown test?searchterm=Header)
 * [Link to absolute path: search + heading](/wiki/view/markdown test?searchterm=Header#table)
 * Raw https Links to youtube will get embedded: https://www.youtube.com/watch?v=ebw3umBx1i0
 * Links to youtube will get embedded: [wiki markdown link](https://www.youtube.com/watch?v=ebw3umBx1i0)
 * Links to youtube basic timestamps (e.g. t=20) will get embedded: [timestamp link](https://www.youtube.com/watch?v=ebw3umBx1i0&t=100)
 * Links to youtube h:m:s formatted (e.g. t=1m20s) timestamps will NOT get embedded: [hms formatted timestamp link](https://www.youtube.com/watch?v=ebw3umBx1i0&t=1m20s)
 * Link with invalid characters [colon link](Topic with : in the name?)

**bold** *italic* __underscore__
---
check out this validity: **8** and not ** 8 ** and not **8 **
so, the ** must wrap non-whitespace characters (there can be **whitespaces inside** of course)
---

Some inline code: `this text is inline code`.
More Text for this Block

code block
```
big block of code....
big block of code....
big block of code....
big block of code....   
```

```
code example
```

example of a
horizontal line vvv
---------
horizontal line ^^^
example....
