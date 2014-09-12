"use strict";

// При добавлении нового элемента ParagraphContent, добавить его обработку в
// следующие функции:
// Internal_Recalculate1, Internal_Recalculate2, Draw, Add,
// Selection_SetEnd, Selection_CalculateTextPr, IsEmpty, Selection_IsEmpty,
// Cursor_IsStart, Cursor_IsEnd, Is_ContentOnFirstPage

// TODO: Надо избавиться от ParaEnd внутри ParaRun, а сам ParaEnd держать также как и ParaNumbering, как параметр
//       внутри самого класса Paragraph

// TODO: Избавиться от функций Internal_GetStartPos, Internal_GetEndPos, Clear_CollaborativeMarks

var type_Paragraph = 0x0001;

var UnknownValue  = null;

// Класс Paragraph
function Paragraph(DrawingDocument, Parent, PageNum, X, Y, XLimit, YLimit, bFromPresentation)
{
    this.Id = g_oIdCounter.Get_NewId();

    this.Prev = null;
    this.Next = null;

    this.Index = -1;

    this.Parent  = Parent;
    this.PageNum = PageNum;

    this.X      = X;
    this.Y      = Y;
    this.XLimit = XLimit;
    this.YLimit = YLimit;

    this.CompiledPr =
    {
        Pr         : null,  // Скомпилированный (окончательный стиль параграфа)
        NeedRecalc : true   // Нужно ли пересчитать скомпилированный стиль
    };
    this.Pr = new CParaPr();

    // Рассчитанное положение рамки
    this.CalculatedFrame =
    {
        L : 0,       // Внутренний рект, по которому идет рассчет
        T : 0,
        W : 0,
        H : 0,
        L2 : 0,      // Внешний рект, с учетом границ
        T2 : 0,
        W2 : 0,
        H2 : 0,
        PageIndex : 0
    };

    // Данный TextPr будет относится только к символу конца параграфа
    this.TextPr = new ParaTextPr();
    this.TextPr.Parent = this;

    // Настройки секции
    this.SectPr = undefined; // undefined или CSectionPr

    this.Bounds = new CDocumentBounds( X, Y, XLimit, Y );

    this.RecalcInfo = new CParaRecalcInfo();

    this.Pages = []; // Массив страниц (CParaPage)
    this.Lines = []; // Массив строк (CParaLine)

    if(!(bFromPresentation === true))
    {
        this.Numbering = new ParaNumbering();
    }
    else
    {
        this.Numbering = new ParaPresentationNumbering();
    }
    this.ParaEnd   =
    {
        Line  : 0,
        Range : 0
    }; //new ParaEnd();
    
    this.CurPos  =
    {
        X           : 0,
        Y           : 0,
        ContentPos  : 0,  // Ближайшая позиция в контенте (между элементами)
        Line        : -1,
        Range       : -1,
        RealX       : 0, // позиция курсора, без учета расположения букв
        RealY       : 0, // это актуально для клавиш вверх и вниз
        PagesPos    : 0  // позиция в массиве this.Pages
    };

    this.Selection = new CParagraphSelection();
    
    this.DrawingDocument = null;
    this.LogicDocument   = null;
    this.bFromDocument   = true;
    
    if ( undefined !== DrawingDocument && null !== DrawingDocument )
    {
        this.DrawingDocument = DrawingDocument;
        this.LogicDocument   = bFromPresentation ? null : this.DrawingDocument.m_oLogicDocument;
        this.bFromDocument   = bFromPresentation === true ? false : !!this.LogicDocument;
    }   

    this.ApplyToAll = false; // Специальный параметр, используемый в ячейках таблицы.
    // True, если ячейка попадает в выделение по ячейкам.

    this.Lock = new CLock(); // Зажат ли данный параграф другим пользователем
    if ( false === g_oIdCounter.m_bLoad )
    {
        //this.Lock.Set_Type( locktype_Mine, false );
        //CollaborativeEditing.Add_Unlock2( this );
    }

    this.DeleteCommentOnRemove    = true; // Удаляем ли комменты в функциях Internal_Content_Remove

    this.m_oContentChanges = new CContentChanges(); // список изменений(добавление/удаление элементов)

    // Свойства необходимые для презентаций
    this.PresentationPr =
    {
        Level  : 0,
        Bullet : new CPresentationBullet()
    };

    this.FontMap =
    {
        Map        : {},
        NeedRecalc : true
    };

    this.SearchResults = {};

    this.SpellChecker  = new CParaSpellChecker(this);

    this.NearPosArray  = [];

    // Добавляем в контент элемент "конец параграфа"
    this.Content = [];
    var EndRun = new ParaRun(this);
    EndRun.Add_ToContent( 0, new ParaEnd() );

    this.Content[0] = EndRun;
    
    this.m_oPRSW = new CParagraphRecalculateStateWrap();
    this.m_oPRSC = new CParagraphRecalculateStateCounter();
    this.m_oPRSA = new CParagraphRecalculateStateAlign();
    this.m_oPRSI = new CParagraphRecalculateStateInfo();
    
    this.m_oPDSE = new CParagraphDrawStateElements();
    this.StartState = null;
    // Добавляем данный класс в таблицу Id (обязательно в конце конструктора)
    g_oTableId.Add( this, this.Id );
    if(bFromPresentation === true)
    {
        this.Save_StartState();
    }
}

Paragraph.prototype =
{
    GetType : function()
    {
        return type_Paragraph;
    },

    Get_Type : function()
    {
        return type_Paragraph;
    },

    Save_StartState : function()
    {
        this.StartState = new CParagraphStartState(this);
    },

    GetId : function()
    {
        return this.Id;
    },

    SetId : function(newId)
    {
        g_oTableId.Reset_Id( this, newId, this.Id );
        this.Id = newId;
    },

    Get_Id : function()
    {
        return this.GetId();
    },

    Set_Id : function(newId)
    {
        return this.SetId( newId );
    },

    Use_Wrap : function()
    {
        if ( true !== this.Is_Inline() )
            return false;

        return true;
    },

    Use_YLimit : function()
    {
        if ( undefined != this.Get_FramePr() && this.Parent instanceof CDocument )
            return false;

        return true;
    },

    Set_Pr : function(oNewPr)
    {
        var Pr_old = this.Pr;
        var Pr_new = oNewPr;
        History.Add( this, { Type : historyitem_Paragraph_Pr, Old : Pr_old, New : Pr_new } );

        this.Pr = oNewPr;

        this.Recalc_CompiledPr();
    },

    Copy : function(Parent, DrawingDocument)
    {
        var Para = new Paragraph(DrawingDocument ? DrawingDocument : this.DrawingDocument, Parent, 0, 0, 0, 0, 0, !this.bFromDocument);

        // Копируем настройки
        Para.Set_Pr(this.Pr.Copy());

        Para.TextPr.Set_Value( this.TextPr.Value.Copy() );

        // Удаляем содержимое нового параграфа
        Para.Internal_Content_Remove2(0, Para.Content.length);       

        // Копируем содержимое параграфа
        var Count = this.Content.length;
        for ( var Index = 0; Index < Count; Index++ )
        {
            var Item = this.Content[Index];
            Para.Internal_Content_Add( Para.Content.length, Item.Copy(false), false );
        }
        
        // TODO: Как только переделаем para_End, переделать тут
        // Поскольку в ране не купируется элемент para_End добавим его здесь отдельно

        var EndRun = new ParaRun(Para);
        EndRun.Add_ToContent( 0, new ParaEnd() );
        Para.Internal_Content_Add( Para.Content.length, EndRun, false );

        // Добавляем секцию в конце
        if ( undefined !== this.SectPr )
        {
            var SectPr = new CSectionPr(this.SectPr.LogicDocument);
            SectPr.Copy(this.SectPr);
            Para.Set_SectionPr(SectPr);
        }
        
        Para.Selection_Remove();
        Para.Cursor_MoveToStartPos(false);

        return Para;
    },

    Copy2 : function(Parent)
    {
        var Para = new Paragraph(this.DrawingDocument, Parent, 0, 0, 0, 0, 0, true);

        // Копируем настройки
        Para.Set_Pr(this.Pr.Copy());

        Para.TextPr.Set_Value( this.TextPr.Value.Copy() );

        // Удаляем содержимое нового параграфа
        Para.Internal_Content_Remove2(0, Para.Content.length);

        // Копируем содержимое параграфа
        var Count = this.Content.length;
        for ( var Index = 0; Index < Count; Index++ )
        {
            var Item = this.Content[Index];
            Para.Internal_Content_Add( Para.Content.length, Item.Copy2(), false );
        }


        Para.Selection_Remove();
        Para.Cursor_MoveToStartPos(false);

        return Para;
    },

    Get_FirstRunPr : function()
    {
        if ( this.Content.length <= 0 || para_Run !== this.Content[0].Type )
            return this.TextPr.Value.Copy();

        return this.Content[0].Pr.Copy();
    },

    Get_FirstTextPr : function()
    {
        if ( this.Content.length <= 0 || para_Run !== this.Content[0].Type )
            return this.Get_CompiledPr2(false).TextPr;

        return this.Content[0].Get_CompiledPr();
    },

    Get_AllDrawingObjects : function(DrawingObjs)
    {
        if ( undefined === DrawingObjs )
            DrawingObjs = [];

        var Count = this.Content.length;
        for ( var Pos = 0; Pos < Count; Pos++ )
        {
            var Item = this.Content[Pos];
            if ( para_Hyperlink === Item.Type || para_Run === Item.Type )
                Item.Get_AllDrawingObjects( DrawingObjs );
        }

        return DrawingObjs;
    },
    
    Get_AllComments : function(List)
    {
        if ( undefined === List )
            List = [];
        
        var Len = this.Content.length;
        for ( var Pos = 0; Pos < Len; Pos++ )
        {
            var Item = this.Content[Pos];
            
            if ( para_Comment === Item.Type )
                List.push( { Comment : Item, Paragraph : this } );
        }
        
        return List;
    },

    Get_AllParagraphs_ByNumbering : function(NumPr, ParaArray)
    {
        var _NumPr = this.Numbering_Get();

        if ( undefined != _NumPr && _NumPr.NumId === NumPr.NumId && ( _NumPr.Lvl === NumPr.Lvl || undefined === NumPr.Lvl ) )
            ParaArray.push( this );

        var Count = this.Content.length;
        for ( var Pos = 0; Pos < Count; Pos++ )
        {
            var Item = this.Content[Pos];
            if ( para_Drawing === Item.Type )
                Item.Get_AllParagraphs_ByNumbering( NumPr, ParaArray );
        }
    },

    Get_PageBounds : function(PageIndex)
    {
        return this.Pages[PageIndex].Bounds;
    },

    Get_EmptyHeight : function()
    {
        var Pr = this.Get_CompiledPr();
        var EndTextPr = Pr.TextPr.Copy();
        EndTextPr.Merge( this.TextPr.Value );

        g_oTextMeasurer.SetTextPr( EndTextPr, this.Get_Theme() );
        g_oTextMeasurer.SetFontSlot( fontslot_ASCII );

        return g_oTextMeasurer.GetHeight();
    },

    Get_Theme: function()
    {
        return this.Parent.Get_Theme();
    },

    Get_ColorMap: function()
    {
        return this.Parent.Get_ColorMap();
    },

    Reset : function (X,Y, XLimit, YLimit, PageNum)
    {
        this.X = X;
        this.Y = Y;
        this.XLimit = XLimit;
        this.YLimit = YLimit;

        this.PageNum = PageNum;

        // При первом пересчете параграфа this.Parent.RecalcInfo.Can_RecalcObject() всегда будет true, а вот при повторных уже нет
        if ( true === this.Parent.RecalcInfo.Can_RecalcObject() )
        {
            var Ranges = this.Parent.CheckRange( X, Y, XLimit, Y, Y, Y, X, XLimit, this.PageNum, true );
            if ( Ranges.length > 0 )
            {
                if ( Math.abs(Ranges[0].X0 - X ) < 0.001 )
                    this.X_ColumnStart = Ranges[0].X1;
                else
                    this.X_ColumnStart = X;

                if ( Math.abs(Ranges[Ranges.length - 1].X1 - XLimit ) < 0.001 )
                    this.X_ColumnEnd = Ranges[Ranges.length - 1].X0;
                else
                    this.X_ColumnEnd = XLimit;
            }
            else
            {
                this.X_ColumnStart = X;
                this.X_ColumnEnd   = XLimit;
            }
        }
    },

    // Копируем свойства параграфа
    CopyPr : function(OtherParagraph)
    {
        return this.CopyPr_Open(OtherParagraph);
    },

    // Копируем свойства параграфа при открытии и копировании
    CopyPr_Open : function(OtherParagraph)
    {
        OtherParagraph.X      = this.X;
        OtherParagraph.XLimit = this.XLimit;

        if ( "undefined" != typeof(OtherParagraph.NumPr) )
            OtherParagraph.Numbering_Remove();

        var NumPr = this.Numbering_Get();
        if ( undefined != NumPr  )
        {
            OtherParagraph.Numbering_Set( NumPr.NumId, NumPr.Lvl );
        }
        // Копируем прямые настройки параграфа в конце, потому что, например, нумерация может
        // их изменить.
        var oOldPr = OtherParagraph.Pr;
        OtherParagraph.Pr = this.Pr.Copy();
        History.Add( OtherParagraph, { Type : historyitem_Paragraph_Pr, Old : oOldPr, New : OtherParagraph.Pr } );

        if(this.bFromDocument)
            OtherParagraph.Style_Add( this.Style_Get(), true );
        
        // TODO: Другой параграф, как правило новый, поэтому можно использовать функцию Apply, но на самом деле надо 
        //       переделать на нормальную функцию Set_Pr.
        OtherParagraph.TextPr.Apply_TextPr( this.TextPr.Value );
    },    

    // Добавляем элемент в содержимое параграфа. (Здесь передвигаются все позиции
    // CurPos.ContentPos, Selection.StartPos, Selection.EndPos)
    Internal_Content_Add : function (Pos, Item, bCorrectPos)
    {
        History.Add( this, { Type : historyitem_Paragraph_AddItem, Pos : Pos, EndPos : Pos, Items : [ Item ] } );
        this.Content.splice( Pos, 0, Item );

        if ( this.CurPos.ContentPos >= Pos )
        {
            this.CurPos.ContentPos++;
            
            if ( this.CurPos.ContentPos >= this.Content.length )
                this.CurPos.ContentPos = this.Content.length - 1;
        }

        if ( this.Selection.StartPos >= Pos )
        {
            this.Selection.StartPos++;

            if ( this.Selection.StartPos >= this.Content.length )
                this.Selection.StartPos = this.Content.length - 1;
        }

        if ( this.Selection.EndPos >= Pos )
        {
            this.Selection.EndPos++;

            if ( this.Selection.EndPos >= this.Content.length )
                this.Selection.EndPos = this.Content.length - 1;
        }

        // Обновляем позиции в NearestPos
        var NearPosLen = this.NearPosArray.length;
        for ( var Index = 0; Index < NearPosLen; Index++ )
        {
            var ParaNearPos = this.NearPosArray[Index];
            var ParaContentPos = ParaNearPos.NearPos.ContentPos;

            if ( ParaContentPos.Data[0] >= Pos )
                ParaContentPos.Data[0]++;
        }

        // Обновляем позиции в SearchResults
        for ( var Id in this.SearchResults )
        {
            var ContentPos = this.SearchResults[Id].StartPos;

            if ( ContentPos.Data[0] >= Pos )
                ContentPos.Data[0]++;

            ContentPos = this.SearchResults[Id].EndPos;

            if ( ContentPos.Data[0] >= Pos )
                ContentPos.Data[0]++;
        }

        // Передвинем все метки слов для проверки орфографии
        // Обновляем позиции в SearchResults
        var SpellingsCount  = this.SpellChecker.Elements.length;
        for ( var Pos = 0; Pos < SpellingsCount; Pos++ )
        {
            var Element = this.SpellChecker.Elements[Pos];
            var ContentPos = Element.StartPos;

            if ( ContentPos.Data[0] >= Pos )
                ContentPos.Data[0]++;

            ContentPos = Element.EndPos;

            if ( ContentPos.Data[0] >= Pos )
                ContentPos.Data[0]++;
        }

        this.SpellChecker.Update_OnAdd( this, Pos, Item );

        Item.Set_Paragraph( this );
    },

    Add_ToContent : function(Pos, Item)
    {
        this.Internal_Content_Add( Pos, Item );
    },

    Remove_FromContent : function(Pos, Count)
    {
        this.Internal_Content_Remove2(Pos, Count);
    },    

    // Добавляем несколько элементов в конец параграфа.
    Internal_Content_Concat : function(Items)
    {
        var StartPos = this.Content.length;
        this.Content = this.Content.concat( Items );

        History.Add( this, { Type : historyitem_Paragraph_AddItem, Pos : StartPos, EndPos : this.Content.length - 1, Items : Items } );

        // Нам нужно сбросить рассчет всех добавленных элементов и выставить у них родительский класс и параграф
        for ( var CurPos = StartPos; CurPos < this.Content.length; CurPos++ )
        {
            this.Content[CurPos].Set_Paragraph( this );
        }

        // Обновлять позиции в NearestPos не надо, потому что мы добавляем новые элементы в конец массива
        this.RecalcInfo.Set_Type_0_Spell( pararecalc_0_Spell_All );
    },

    // Удаляем элемент из содержимого параграфа. (Здесь передвигаются все позиции
    // CurPos.ContentPos, Selection.StartPos, Selection.EndPos)
    Internal_Content_Remove : function (Pos)
    {
        var Item = this.Content[Pos];
        History.Add( this, { Type : historyitem_Paragraph_RemoveItem, Pos : Pos, EndPos : Pos, Items : [ Item ] } );
        this.Content.splice( Pos, 1 );

        if ( this.Selection.StartPos > Pos )
        {
            this.Selection.StartPos--;
            
            if ( this.Selection.StartPos < 0 )
                this.Selection.StartPos = 0;
        }

        if ( this.Selection.EndPos >= Pos )
        {
            this.Selection.EndPos--;
            
            if ( this.Selection.EndPos < 0 )
                this.Selection.EndPos = 0;
        }

        if ( this.CurPos.ContentPos > Pos )
        {
            this.CurPos.ContentPos--;
            
            if ( this.CurPos.ContentPos < 0 )
                this.CurPos.ContentPos = 0;
        }

        // Обновляем позиции в NearestPos
        var NearPosLen = this.NearPosArray.length;
        for ( var Index = 0; Index < NearPosLen; Index++ )
        {
            var ParaNearPos = this.NearPosArray[Index];
            var ParaContentPos = ParaNearPos.NearPos.ContentPos;

            if ( ParaContentPos.Data[0] > Pos )
                ParaContentPos.Data[0]--;
        }

        // Обновляем позиции в SearchResults
        for ( var Id in this.SearchResults )
        {
            var ContentPos = this.SearchResults[Id].StartPos;

            if ( ContentPos.Data[0] > Pos )
                ContentPos.Data[0]--;

            ContentPos = this.SearchResults[Id].EndPos;

            if ( ContentPos.Data[0] > Pos )
                ContentPos.Data[0]--;
        }

        // Удаляем комментарий, если это необходимо
        if ( true === this.DeleteCommentOnRemove && para_Comment === Item.Type )
            this.LogicDocument.Remove_Comment( Item.CommentId, true, false );

        var SpellingsCount  = this.SpellChecker.Elements.length;
        for ( var Pos = 0; Pos < SpellingsCount; Pos++ )
        {
            var Element = this.SpellChecker.Elements[Pos];
            var ContentPos = Element.StartPos;

            if ( ContentPos.Data[0] > Pos )
                ContentPos.Data[0]--;

            ContentPos = Element.EndPos;

            if ( ContentPos.Data[0] > Pos )
                ContentPos.Data[0]--;
        }

        // Передвинем все метки слов для проверки орфографии
        this.SpellChecker.Update_OnRemove( this, Pos, 1 );
    },

    // Удаляем несколько элементов
    Internal_Content_Remove2 : function(Pos, Count)
    {
        var CommentsToDelete = [];
        if ( true === this.DeleteCommentOnRemove && null !== this.LogicDocument )
        {
            var DocumentComments = this.LogicDocument.Comments;
            for ( var Index = Pos; Index < Pos + Count; Index++ )
            {
                var Item = this.Content[Index];
                if ( para_Comment === Item.Type )
                {
                    var CommentId = Item.CommentId;
                    var Comment = DocumentComments.Get_ById( CommentId );
                    
                    if ( null != Comment )
                    {
                        if ( true === Item.Start )
                            Comment.Set_StartId( null );
                        else
                            Comment.Set_EndId( null );
                    }

                    CommentsToDelete.push(CommentId);
                }
            }
        }

        var DeletedItems = this.Content.slice( Pos, Pos + Count );
        History.Add( this, { Type : historyitem_Paragraph_RemoveItem, Pos : Pos, EndPos : Pos + Count - 1, Items : DeletedItems } );

        if ( this.Selection.StartPos > Pos + Count )
            this.Selection.StartPos -= Count;
        else if ( this.Selection.StartPos > Pos )
            this.Selection.StartPos = Pos;

        if ( this.Selection.EndPos > Pos + Count )
            this.Selection.EndPos -= Count;
        if ( this.Selection.EndPos > Pos )
            this.Selection.EndPos = Pos;

        if ( this.CurPos.ContentPos > Pos + Count )
            this.CurPos.ContentPos -= Count;
        else if ( this.CurPos.ContentPos > Pos )
            this.CurPos.ContentPos = Pos;

        // Обновляем позиции в NearestPos
        var NearPosLen = this.NearPosArray.length;
        for ( var Index = 0; Index < NearPosLen; Index++ )
        {
            var ParaNearPos = this.NearPosArray[Index];
            var ParaContentPos = ParaNearPos.NearPos.ContentPos;

            if ( ParaContentPos.Data[0] > Pos + Count )
                ParaContentPos.Data[0] -= Count;
            else if ( ParaContentPos.Data[0] > Pos )
                ParaContentPos.Data[0] = Math.max( 0, Pos );
        }

        this.Content.splice( Pos, Count );

        // Комментарии удаляем после, чтобы не нарушить позиции
        var CountCommentsToDelete = CommentsToDelete.length;
        for ( var Index = 0; Index < CountCommentsToDelete; Index++ )
        {
            this.LogicDocument.Remove_Comment( CommentsToDelete[Index], true, false );
        }

        // Передвинем все метки слов для проверки орфографии
        this.SpellChecker.Update_OnRemove( this, Pos, Count );
    },

    Clear_ContentChanges : function()
    {
        this.m_oContentChanges.Clear();
    },

    Add_ContentChanges : function(Changes)
    {
        this.m_oContentChanges.Add( Changes );
    },

    Refresh_ContentChanges : function()
    {
        this.m_oContentChanges.Refresh();
    },

    Get_CurrentParaPos : function()
    {
        // Сначала определим строку и отрезок
        var ParaPos = this.Content[this.CurPos.ContentPos].Get_CurrentParaPos();

        if ( -1 !== this.CurPos.Line )
        {
            ParaPos.Line  = this.CurPos.Line;
            ParaPos.Range = this.CurPos.Range;
        }

        var CurLine = ParaPos.Line;

        // Определим страницу
        var PagesCount = this.Pages.length;
        for ( var CurPage = PagesCount - 1; CurPage >= 0; CurPage-- )
        {
            var Page = this.Pages[CurPage];
            if ( CurLine >= Page.StartLine && CurLine <= Page.EndLine )
            {
                ParaPos.Page = CurPage;
                return ParaPos;
            }
        }

        return ParaPos;
    },

    Get_ParaPosByContentPos : function(ContentPos)
    {
        // Сначала определим строку и отрезок
        var ParaPos = this.Content[ContentPos.Get(0)].Get_ParaPosByContentPos(ContentPos, 1);
        var CurLine = ParaPos.Line;

        // Определим страницу
        var PagesCount = this.Pages.length;
        for ( var CurPage = PagesCount - 1; CurPage >= 0; CurPage-- )
        {
            var Page = this.Pages[CurPage];
            if ( CurLine >= Page.StartLine && CurLine <= Page.EndLine )
            {
                ParaPos.Page = CurPage;
                return ParaPos;
            }
        }

        return ParaPos;
    },   

    // Пересчет переносов строк в параграфе, с учетом возможного обтекания
    Recalculate_Page__ : function(CurPage)
    {
        var PRS = this.m_oPRSW;
        PRS.Paragraph = this;
        PRS.Page      = CurPage;

        PRS.RunRecalcInfoLast  = ( 0 === CurPage ? null : this.Pages[CurPage - 1].EndInfo.RunRecalcInfo );
        PRS.RunRecalcInfoBreak = PRS.RunRecalcInfoLast;

        var Pr     = this.Get_CompiledPr();
        var ParaPr = Pr.ParaPr;

        var StartLine = ( CurPage > 0 ? this.Pages[CurPage - 1].EndLine + 1 : 0 );       

        //-------------------------------------------------------------------------------------------------------------
        // Обрабатываем настройку "не отрывать от следующего"
        //-------------------------------------------------------------------------------------------------------------
        // Такая настройка срабатывает в единственном случае:
        // У предыдущего параграфа выставлена данная настройка, а текущий параграф сразу начинается с новой страницы
        // ( при этом у него не выставлен флаг "начать с новой страницы", иначе будет зацикливание здесь ).
        if ( 1 === CurPage && this.Pages[0].EndLine < 0 && this.Parent instanceof CDocument && false === ParaPr.PageBreakBefore )
        {
            // Если у предыдущего параграфа стоит настройка "не отрывать от следующего".
            // И сам параграф не разбит на несколько страниц и не начинается с новой страницы,
            // тогда мы должны пересчитать предыдущую страницу, с учетом того, что предыдущий параграф
            // надо начать с новой страницы.
            var Curr = this.Get_DocumentPrev();
            while ( null != Curr && type_Paragraph === Curr.GetType() && undefined === Curr.Get_SectionPr() )
            {
                var CurrKeepNext = Curr.Get_CompiledPr2(false).ParaPr.KeepNext;
                if ( (true === CurrKeepNext && Curr.Pages.length > 1) || false === CurrKeepNext || true !== Curr.Is_Inline() || true === Curr.Check_PageBreak() )
                {
                    break;
                }
                else
                {
                    var Prev = Curr.Get_DocumentPrev();
                    if ( null === Prev || type_Paragraph != Prev.GetType() || undefined !== Prev.Get_SectionPr() )
                        break;

                    var PrevKeepNext = Prev.Get_CompiledPr2(false).ParaPr.KeepNext;
                    if ( false === PrevKeepNext )
                    {
                        if ( true === this.Parent.RecalcInfo.Can_RecalcObject() )
                        {
                            this.Parent.RecalcInfo.Set_KeepNext(Curr);
                            PRS.RecalcResult = recalcresult_PrevPage;
                            return PRS.RecalcResult;
                        }
                        else
                            break;
                    }
                    else
                        Curr = Prev;
                }
            }
        }

        //-------------------------------------------------------------------------------------------------------------
        // Получаем начальные координаты параграфа
        //-------------------------------------------------------------------------------------------------------------
        // Если это первая страница параграфа (CurPage = 0), тогда мы должны использовать координаты, которые нам
        // были заданы сверху, а если не первая, тогда координаты мы должны запросить у родительского класса.
        // TODO: Тут отдельно обрабатывается случай, когда рамка переносится на новую страницу, т.е. страница начинается 
        //       сразу с рамки. Надо бы не разбивать в данной ситуации рамку на страницы, а просто новую страницу начать
        //       с нее на уровне DocumentContent.

        var XStart, YStart, XLimit, YLimit;
        if ( 0 === CurPage || ( undefined != this.Get_FramePr() && this.LogicDocument === this.Parent ) )
        {
            XStart = this.X;
            YStart = this.Y;
            XLimit = this.XLimit;
            YLimit = this.YLimit;
        }
        else
        {
            var PageStart = this.Parent.Get_PageContentStartPos( this.PageNum + CurPage, this.Index );

            XStart = PageStart.X;
            YStart = PageStart.Y;
            XLimit = PageStart.XLimit;
            YLimit = PageStart.YLimit;
        }

        PRS.XStart = XStart;
        PRS.YStart = YStart;
        PRS.XLimit = XLimit - ParaPr.Ind.Right;
        PRS.YLimit = YLimit;

        PRS.Y = YStart;
        //-------------------------------------------------------------------------------------------------------------
        // Создаем новую страницу
        //-------------------------------------------------------------------------------------------------------------
        var CurLine = StartLine;
        this.Pages.length = CurPage + 1
        this.Pages[CurPage] = new CParaPage( XStart, YStart, XLimit, YLimit, StartLine );

        // Изначально обнуляем промежутки обтекания и наличие переноса строки
        PRS.Reset_Ranges();
        PRS.Reset_PageBreak();

        //-------------------------------------------------------------------------------------------------------------
        // Делаем проверки, не нужно ли сразу перенести параграф на новую страницу
        //-------------------------------------------------------------------------------------------------------------
        if ( this.Parent instanceof CDocument )
        {
            // Начинаем параграф с новой страницы
            if ( 0 === CurPage && true === ParaPr.PageBreakBefore )
            {
                // Если это первый элемент документа или секции, тогда не надо начинать его с новой страницы.
                // Кроме случая, когда у нас разрыв секции на текущей странице. Также не добавляем разрыв страницы для 
                // особого пустого параграфа с разрывом секции.
                
                var bNeedPageBreak = true;

                var Prev = this.Get_DocumentPrev();
                if ( (true === this.IsEmpty() && undefined !== this.Get_SectionPr()) || null === Prev )
                    bNeedPageBreak = false;
                else if ( this.Parent === this.LogicDocument && type_Paragraph === Prev.GetType() && undefined !== Prev.Get_SectionPr()  )
                {
                    var PrevSectPr = Prev.Get_SectionPr();
                    var CurSectPr  = this.LogicDocument.SectionsInfo.Get_SectPr( this.Index).SectPr;
                    if ( section_type_Continuous !== CurSectPr.Get_Type() || true !== CurSectPr.Compare_PageSize( PrevSectPr ) )
                        bNeedPageBreak = false;                    
                }
                
                if ( true === bNeedPageBreak )
                {
                    // Добавляем разрыв страницы
                    this.Pages[CurPage].Set_EndLine( CurLine - 1 );

                    if (  0 === CurLine )
                        this.Lines[-1] = new CParaLine(0);

                    PRS.RecalcResult = recalcresult_NextPage;
                    return PRS.RecalcResult;
                }
            }
            else if  ( true === this.Parent.RecalcInfo.Check_WidowControl( this, CurLine ) )
            {
                this.Parent.RecalcInfo.Reset_WidowControl();

                this.Pages[CurPage].Set_EndLine( CurLine - 1 );
                if ( 0 === CurLine )
                    this.Lines[-1] = new CParaLine( 0 );

                PRS.RecalcResult = recalcresult_NextPage;
                return PRS.RecalcResult;
            }
            else if ( true === this.Parent.RecalcInfo.Check_KeepNext(this) && 0 === CurPage && null != this.Get_DocumentPrev() )
            {
                this.Parent.RecalcInfo.Reset();

                this.Pages[CurPage].Set_EndLine( CurLine - 1 );
                if ( 0 === CurLine )
                    this.Lines[-1] = new CParaLine( 0 );

                PRS.RecalcResult = recalcresult_NextPage;
                return PRS.RecalcResult;
            }
        }

        var RecalcResult = recalcresult_NextElement;
        while ( true )
        {
            PRS.Line = CurLine;
            PRS.RecalcResult = recalcresult_NextLine;

            this.Recalculate_Line(PRS, ParaPr);

            RecalcResult = PRS.RecalcResult;

            if ( recalcresult_NextLine === RecalcResult )
            {
                // В эту ветку мы попадаем, если строка пересчиталась в нормальном режиме и можно переходить к следующей.
                CurLine++;
                PRS.Reset_Ranges();
                PRS.Reset_PageBreak();
                PRS.Reset_RunRecalcInfo();

                continue;
            }
            else if ( recalcresult_CurLine === RecalcResult )
            {
                // В эту ветку мы попадаем, если нам необходимо заново пересчитать данную строку. Такое случается
                // когда у нас появляются плавающие объекты, относительно которых необходимо произвести обтекание.
                // В данном случае мы ничего не делаем, т.к. номер строки не меняется, а новые отрезки обтекания
                // были заполнены при последнем неудачном рассчете.

                PRS.Restore_RunRecalcInfo();
                continue;
            }
            else if ( recalcresult_NextElement === RecalcResult || recalcresult_NextPage === RecalcResult )
            {
                // В эту ветку мы попадаем, если мы достигли конца страницы или конца параграфа. Просто выходим
                // из цикла.
                break;
            }
            else //if ( recalcresult_CurPage === RecalcResult || recalcresult_PrevPage === RecalcResult )
            {
                // В эту ветку мы попадаем, если в нашем параграфе встретилось, что-то из-за чего надо пересчитывать
                // эту страницу или предыдущую страницу. Поэтому далее можно ничего не делать, а сообщать верхнему
                // классу об этом.
                return RecalcResult;
            }
        }

        //-------------------------------------------------------------------------------------------------------------
        // Выставляем Baseline в наших строках
        //-------------------------------------------------------------------------------------------------------------
        var EndLine = this.Lines.length - 1;

        var TempDy = this.Lines[this.Pages[CurPage].FirstLine].Metrics.Ascent;
        if ( 0 === StartLine && ( 0 === CurPage || true === this.Parent.Is_TableCellContent() || true === ParaPr.PageBreakBefore ) )
            TempDy += ParaPr.Spacing.Before;

        if ( 0 === StartLine )
        {
            if ( ( true === ParaPr.Brd.First || 1 === CurPage ) && border_Single === ParaPr.Brd.Top.Value )
                TempDy += ParaPr.Brd.Top.Size + ParaPr.Brd.Top.Space;
            else if ( false === ParaPr.Brd.First && border_Single === ParaPr.Brd.Between.Value )
                TempDy += ParaPr.Brd.Between.Size + ParaPr.Brd.Between.Space;
        }

        for ( var Index = StartLine; Index <= EndLine; Index++ )
        {
            this.Lines[Index].Y += TempDy;
            if ( this.Lines[Index].Metrics.LineGap < 0 )
                this.Lines[Index].Y += this.Lines[Index].Metrics.LineGap;
        }
        //-------------------------------------------------------------------------------------------------------------
        // Получаем некоторую информацию для следующей страницы (например незакрытые комментарии)
        //-------------------------------------------------------------------------------------------------------------
        this.Recalculate_PageEndInfo(PRS, CurPage);

        //-------------------------------------------------------------------------------------------------------------
        // Рассчитываем ширину каждого отрезка, количество слов и пробелов в нем
        //-------------------------------------------------------------------------------------------------------------
        this.Recalculate_Lines_Width(CurPage);

        //-------------------------------------------------------------------------------------------------------------
        // Пересчитываем сдвиги элементов внутри параграфа и видимые ширины пробелов, в зависимости от align.
        //-------------------------------------------------------------------------------------------------------------
        var RecalcResultAlign = this.Recalculate_Lines_Align(PRS, CurPage, ParaPr, false);

        if ( recalcresult_NextElement !== RecalcResultAlign )
            return RecalcResultAlign;

        return RecalcResult;
    },

    Recalculate_Range : function(ParaPr)
    {
        var PRS = this.m_oPRSW;

        var CurLine     = PRS.Line;
        var CurRange    = PRS.Range;
        var CurPage     = PRS.Page;
        var RangesCount = PRS.RangesCount;

        // Найдем начальную позицию данного отрезка
        var StartPos = 0;
        if ( 0 === CurLine && 0 === CurRange )
            StartPos = 0;
        else if ( CurRange > 0 )
            StartPos = this.Lines[CurLine].Ranges[CurRange - 1].EndPos;
        else
            StartPos = this.Lines[CurLine - 1].Ranges[ this.Lines[CurLine - 1].Ranges.length - 1 ].EndPos;

        var Line = this.Lines[CurLine];
        var Range = Line.Ranges[CurRange];

        this.Lines[CurLine].Set_RangeStartPos( CurRange, StartPos );

        if ( true === PRS.UseFirstLine && 0 !== CurRange && true === PRS.EmptyLine )
        {
            if ( ParaPr.Ind.FirstLine < 0 )
            {
                Range.X += ParaPr.Ind.Left + ParaPr.Ind.FirstLine;
            }
            else
            {
                Range.X += ParaPr.Ind.FirstLine;
            }
        }

        var X    = Range.X;
        var XEnd =  ( CurRange == RangesCount ? PRS.XLimit : PRS.Ranges[CurRange].X0 );

        // Обновляем состояние пересчета
        PRS.Reset_Range(X, XEnd);

        var ContentLen = this.Content.length;

        var Pos = StartPos;
        for ( ;Pos < ContentLen; Pos++ )
        {
            var Item = this.Content[Pos];
            
            if ( para_Math === Item.Type )
            {
                // TODO: Надо бы перенести эту проверку на изменение контента параграфа
                Item.MathPara = this.Check_MathPara(Pos);
            }

            if ( ( 0 === Pos && 0 === CurLine && 0 === CurRange ) || Pos !== StartPos )
            {
                Item.Recalculate_Reset( CurRange, CurLine );
            }

            PRS.Update_CurPos( Pos, 0 );
            Item.Recalculate_Range( PRS, ParaPr, 1 );

            if ( true === PRS.NewRange )
            {
                break;
            }
        }

        if ( Pos >= ContentLen )
            Pos = ContentLen - 1;

        if ( recalcresult_NextLine === PRS.RecalcResult )
        {
            // У нас отрезок пересчитался нормально и тут возможны 2 варианта :
            // 1. Отрезок закончился в данной позиции
            // 2. Не все убралось в заданный отрезок и перенос нужно поставить в позиции PRS.LineBreakPos

            if ( true === PRS.MoveToLBP )
            {
                // Отмечаем, что в заданной позиции заканчивается отрезок
                this.Recalculate_Set_RangeEndPos( PRS, PRS.LineBreakPos, 0 );
            }
            else
                this.Lines[CurLine].Set_RangeEndPos( CurRange, Pos );
        }
    },

    Recalculate_Line : function(PRS, ParaPr)
    {
        var CurLine  = PRS.Line;
        var CurPage  = PRS.Page;
        var CurRange = 0;

        this.Lines.length = CurLine + 1;
        this.Lines[CurLine] = new CParaLine();

        if ( true === PRS.RangeY )
        {
            PRS.RangeY = false;
            this.Lines[CurLine].RangeY = true;
        }
        else
            this.Lines[CurLine].RangeY = false;

        // Проверим висячую строку
        if ( this.Parent instanceof CDocument && true === this.Parent.RecalcInfo.Check_WidowControl(this, CurLine) )
        {
            this.Parent.RecalcInfo.Reset_WidowControl();

            this.Pages[CurPage].Set_EndLine( CurLine - 1 );
            if ( 0 === CurLine )
            {
                this.Lines[-1] = new CParaLine( 0 );
            }

            PRS.RecalcResult = recalcresult_NextPage;
            return;
        }

        // Параметры Ranges и RangesCount не обнуляются здесь, они задаются выше
        var Ranges      = PRS.Ranges;
        var RangesCount = PRS.RangesCount;

        // Обнуляем параметры PRS для строки
        PRS.Reset_Line();
        
        // Проверим, нужно ли в данной строке учитывать FirstLine (т.к. не всегда это первая строка должна быть)
        var UseFirstLine = true;
        for ( var TempCurLine = CurLine - 1; TempCurLine >= 0; TempCurLine-- )
        {
            var TempLineInfo = this.Lines[TempCurLine].LineInfo;
            if ( !(TempLineInfo & 1) || !(TempLineInfo & 2) )                
            {
                UseFirstLine = false;
                break;
            }
        }
        
        PRS.UseFirstLine = UseFirstLine;

        // Заполняем строку отрезками обтекания. Выставляем начальные сдвиги для отрезков. Начало промежутка = конец вырезаемого промежутка
        this.Lines[CurLine].Reset();
        this.Lines[CurLine].Add_Range( ( true === UseFirstLine ? PRS.XStart + ParaPr.Ind.Left + ParaPr.Ind.FirstLine : PRS.XStart + ParaPr.Ind.Left ), (RangesCount == 0 ? PRS.XLimit : Ranges[0].X0) );
        for ( var Index = 1; Index < Ranges.length + 1; Index++ )
        {
            this.Lines[CurLine].Add_Range( Ranges[Index - 1].X1, (RangesCount == Index ? PRS.XLimit : Ranges[Index].X0) );
        }

        // При пересчете любой строки обновляем эти поля
        this.ParaEnd.Line  = -1;
        this.ParaEnd.Range = -1;

        while ( CurRange <= RangesCount )
        {
            PRS.Range = CurRange;
            this.Recalculate_Range( ParaPr );

            if ( true === PRS.ForceNewPage || true === PRS.NewPage )
            {
                // Поскольку мы выходим досрочно из цикла, нам надо удалить лишние отрезки обтекания
                this.Lines[CurLine].Ranges.length = CurRange + 1;
                
                break;
            }
            
            if ( -1 === this.ParaEnd.Line && true === PRS.End )
            {
                this.ParaEnd.Line  = CurLine;
                this.ParaEnd.Range = CurRange;
            }

            // Такое может случиться, если мы насильно переносим автофигуру на следующую страницу
            if (recalcresult_NextPage === PRS.RecalcResult)
                return;

            CurRange++;
        }
        
        //-------------------------------------------------------------------------------------------------------------
        // 1. Обновляем метрики данной строки
        //-------------------------------------------------------------------------------------------------------------

        // Строка пустая, у нее надо выставить ненулевую высоту. Делаем как Word, выставляем высоту по размеру
        // текста, на котором закончилась данная строка.
        if ( true === PRS.EmptyLine || PRS.LineAscent < 0.001 )
        {
            var LastItem = ( true === PRS.End ? this.Content[this.Content.length - 1] : this.Content[this.Lines[CurLine].EndPos] );

            if ( true === PRS.End )
            {
                // TODO: Как только переделаем para_End переделать тут
                
                // Выставляем настройки для символа параграфа
                var EndTextPr = this.Get_CompiledPr2(false).TextPr.Copy();
                EndTextPr.Merge(this.TextPr.Value);

                g_oTextMeasurer.SetTextPr( EndTextPr, this.Get_Theme());
                g_oTextMeasurer.SetFontSlot( fontslot_ASCII );

                // Запрашиваем текущие метрики шрифта, под TextAscent мы будем понимать ascent + linegap(которые записаны в шрифте)
                var EndTextHeight  = g_oTextMeasurer.GetHeight();
                var EndTextDescent = Math.abs( g_oTextMeasurer.GetDescender() );
                var EndTextAscent  = EndTextHeight - EndTextDescent;
                var EndTextAscent2 = g_oTextMeasurer.GetAscender();
                                
                PRS.LineTextAscent  = EndTextAscent;
                PRS.LineTextAscent2 = EndTextAscent2;
                PRS.LineTextDescent = EndTextDescent;

                if ( PRS.LineAscent < EndTextAscent )
                    PRS.LineAscent = EndTextAscent;

                if ( PRS.LineDescent < EndTextDescent )
                    PRS.LineDescent = EndTextDescent;
            }
            else if ( undefined !== LastItem )
            {
                var LastRun = LastItem.Get_LastRunInRange(PRS.Line, PRS.Range);
                if ( undefined !== LastRun && null !== LastRun )
                {
                    if ( PRS.LineTextAscent < LastRun.TextAscent )
                        PRS.LineTextAscent = LastRun.TextAscent;

                    if ( PRS.LineTextAscent2 < LastRun.TextAscent2 )
                        PRS.LineTextAscent2 = LastRun.TextAscent2;

                    if ( PRS.LineTextDescent < LastRun.TextDescent )
                        PRS.LineTextDescent = LastRun.TextDescent;

                    if ( PRS.LineAscent < LastRun.TextAscent )
                        PRS.LineAscent = LastRun.TextAscent;

                    if ( PRS.LineDescent < LastRun.TextDescent )
                        PRS.LineDescent = LastRun.TextDescent;
                }
            }
        }

        // Рассчитаем метрики строки
        this.Lines[CurLine].Metrics.Update( PRS.LineTextAscent, PRS.LineTextAscent2, PRS.LineTextDescent, PRS.LineAscent, PRS.LineDescent, ParaPr );

        //-------------------------------------------------------------------------------------------------------------
        // 2. Рассчитываем высоту строки, а также положение верхней и нижней границ
        //-------------------------------------------------------------------------------------------------------------

        // Рассчитаем высоту строки (заодно сохраним верх и низ)
        var TempDy = this.Lines[this.Pages[CurPage].FirstLine].Metrics.Ascent;
        if ( 0 === this.Pages[CurPage].FirstLine && ( 0 === CurPage || true === this.Parent.Is_TableCellContent() || true === ParaPr.PageBreakBefore ) )
            TempDy += ParaPr.Spacing.Before;

        if ( 0 === this.Pages[CurPage].FirstLine )
        {
            if ( ( true === ParaPr.Brd.First || 1 === CurPage ) && border_Single === ParaPr.Brd.Top.Value )
                TempDy += ParaPr.Brd.Top.Size + ParaPr.Brd.Top.Space;
            else if ( false === ParaPr.Brd.First && border_Single === ParaPr.Brd.Between.Value )
                TempDy += ParaPr.Brd.Between.Size + ParaPr.Brd.Between.Space;
        }

        var Top, Bottom;
        var Top2, Bottom2; // верх и низ без Pr.Spacing

        var LastPage_Bottom = this.Pages[CurPage].Bounds.Bottom;

        if ( true === this.Lines[CurLine].RangeY )
        {
            Top  = PRS.Y;
            Top2 = PRS.Y;

            if ( 0 === CurLine )
            {
                if ( 0 === CurPage || true === this.Parent.Is_TableCellContent() )
                {
                    Top2    = Top + ParaPr.Spacing.Before;
                    Bottom2 = Top + ParaPr.Spacing.Before + this.Lines[0].Metrics.Ascent + this.Lines[0].Metrics.Descent;

                    if ( true === ParaPr.Brd.First && border_Single === ParaPr.Brd.Top.Value )
                    {
                        Top2    += ParaPr.Brd.Top.Size + ParaPr.Brd.Top.Space;
                        Bottom2 += ParaPr.Brd.Top.Size + ParaPr.Brd.Top.Space;
                    }
                    else if ( false === ParaPr.Brd.First && border_Single === ParaPr.Brd.Between.Value )
                    {
                        Top2    += ParaPr.Brd.Between.Size + ParaPr.Brd.Between.Space;
                        Bottom2 += ParaPr.Brd.Between.Size + ParaPr.Brd.Between.Space;
                    }
                }
                else
                {
                    // Параграф начинается с новой страницы
                    Bottom2 = Top + this.Lines[0].Metrics.Ascent + this.Lines[0].Metrics.Descent;

                    if ( border_Single === ParaPr.Brd.Top.Value )
                    {
                        Top2    += ParaPr.Brd.Top.Size + ParaPr.Brd.Top.Space;
                        Bottom2 += ParaPr.Brd.Top.Size + ParaPr.Brd.Top.Space;
                    }
                }
            }
            else
            {
                Bottom2 = Top + this.Lines[CurLine].Metrics.Ascent + this.Lines[CurLine].Metrics.Descent;
            }
        }
        else
        {
            if ( 0 !== CurLine )
            {
                if ( CurLine !== this.Pages[CurPage].FirstLine )
                {
                    Top     = PRS.Y + TempDy + this.Lines[CurLine - 1].Metrics.Descent + this.Lines[CurLine - 1].Metrics.LineGap;
                    Top2    = Top;
                    Bottom2 = Top + this.Lines[CurLine].Metrics.Ascent + this.Lines[CurLine].Metrics.Descent;
                }
                else
                {
                    Top     = this.Pages[CurPage].Y;
                    Top2    = Top;
                    Bottom2 = Top + this.Lines[CurLine].Metrics.Ascent + this.Lines[CurLine].Metrics.Descent;
                }
            }
            else
            {
                Top  = PRS.Y;
                Top2 = PRS.Y;

                if ( 0 === CurPage || true === this.Parent.Is_TableCellContent() || true === ParaPr.PageBreakBefore )
                {
                    Top2    = Top + ParaPr.Spacing.Before;
                    Bottom2 = Top + ParaPr.Spacing.Before + this.Lines[0].Metrics.Ascent + this.Lines[0].Metrics.Descent;

                    if ( true === ParaPr.Brd.First && border_Single === ParaPr.Brd.Top.Value )
                    {
                        Top2    += ParaPr.Brd.Top.Size + ParaPr.Brd.Top.Space;
                        Bottom2 += ParaPr.Brd.Top.Size + ParaPr.Brd.Top.Space;
                    }
                    else if ( false === ParaPr.Brd.First && border_Single === ParaPr.Brd.Between.Value )
                    {
                        Top2    += ParaPr.Brd.Between.Size + ParaPr.Brd.Between.Space;
                        Bottom2 += ParaPr.Brd.Between.Size + ParaPr.Brd.Between.Space;
                    }
                }
                else
                {
                    // Параграф начинается с новой страницы
                    Bottom2 = Top + this.Lines[0].Metrics.Ascent + this.Lines[0].Metrics.Descent;

                    if ( border_Single === ParaPr.Brd.Top.Value )
                    {
                        Top2    += ParaPr.Brd.Top.Size + ParaPr.Brd.Top.Space;
                        Bottom2 += ParaPr.Brd.Top.Size + ParaPr.Brd.Top.Space;
                    }
                }
            }
        }

        Bottom  = Bottom2;
        Bottom += this.Lines[CurLine].Metrics.LineGap;

        // Если данная строка последняя, тогда подкорректируем нижнюю границу
        if ( true === PRS.End )
        {
            Bottom += ParaPr.Spacing.After;

            // Если нижняя граница Between, тогда она учитывается в следующем параграфе
            if ( true === ParaPr.Brd.Last && border_Single === ParaPr.Brd.Bottom.Value )
            {
                Bottom += ParaPr.Brd.Bottom.Size + ParaPr.Brd.Bottom.Space;
            }
            else if ( border_Single === ParaPr.Brd.Between.Value )
            {
                Bottom += ParaPr.Brd.Between.Space;
            }

            if ( false === this.Parent.Is_TableCellContent() && Bottom > this.YLimit && Bottom - this.YLimit <= ParaPr.Spacing.After )
                Bottom = this.YLimit;
            
            // В ячейке перенос страницы происходит по нижней границе, т.е. с учетом Spacing.After и границы
            if ( true === this.Parent.Is_TableCellContent() )
                Bottom2 = Bottom;
        }

        // Верхнюю границу мы сохраняем только для первой строки данной страницы
        if ( CurLine === this.Pages[CurPage].FirstLine && true !== this.Lines[CurLine].RangeY )
            this.Pages[CurPage].Bounds.Top = Top;

        this.Pages[CurPage].Bounds.Bottom = Bottom;

        this.Lines[CurLine].Top    = Top    - this.Pages[CurPage].Y;
        this.Lines[CurLine].Bottom = Bottom - this.Pages[CurPage].Y;

        //-------------------------------------------------------------------------------------------------------------
        // 3. Проверяем достигла ли данная строка конца страницы
        //-------------------------------------------------------------------------------------------------------------

        // Переносим строку по PageBreak. Если в строке ничего нет, кроме PageBreak, тогда нам не надо проверять высоту строки и обтекание.
        var bBreakPageLineEmpty = ( true === PRS.BreakPageLine && true === PRS.EmptyLine );
        
        // Сохраним это, чтобы знать, использовать ли FirstLine в следующей строке или нет 
        this.Lines[CurLine].LineInfo = 0;
        
        if ( true === PRS.BreakPageLine )
            this.Lines[CurLine].LineInfo |= 1;
        
        if ( true === PRS.EmptyLine )
            this.Lines[CurLine].LineInfo |= 2;
        
        if ( true === PRS.End )
            this.Lines[CurLine].LineInfo |= 4;

        // Сначала проверяем не нужно ли сделать перенос страницы в данном месте
        // Перенос не делаем, если это первая строка на новой странице
        if ( true === this.Use_YLimit() && (Top > this.YLimit || Bottom2 > this.YLimit ) && ( CurLine != this.Pages[CurPage].FirstLine || ( 0 === CurPage && ( null != this.Get_DocumentPrev() || true === this.Parent.Is_TableCellContent() ) ) ) && false === bBreakPageLineEmpty )
        {
            // Проверим висячую строку
            if ( this.Parent instanceof CDocument && true === this.Parent.RecalcInfo.Can_RecalcObject() &&
                true === ParaPr.WidowControl && CurLine - this.Pages[CurPage].StartLine <= 1 && CurLine >= 1 && true != PRS.BreakPageLine && ( 0 === CurPage && null != this.Get_DocumentPrev() ) )
            {
                // TODO: Здесь перенос нужно делать сразу же
                this.Parent.RecalcInfo.Set_WidowControl(this, CurLine - 1);
                PRS.RecalcResult = recalcresult_CurPage;
                return;
            }
            else
            {
                // Неразрывные абзацы не учитываются в таблицах
                if ( true === ParaPr.KeepLines && null != this.Get_DocumentPrev() && true != this.Parent.Is_TableCellContent() && 0 === CurPage )
                {
                    CurLine       = 0;
                }

                // Восстанавливаем позицию нижней границы предыдущей страницы
                this.Pages[CurPage].Bounds.Bottom = LastPage_Bottom;
                this.Pages[CurPage].Set_EndLine( CurLine - 1 );

                if ( 0 === CurLine )
                    this.Lines[-1] = new CParaLine(0);

                // Добавляем разрыв страницы
                PRS.RecalcResult = recalcresult_NextPage;
                return;
            }
        }

        //-------------------------------------------------------------------------------------------------------------
        // 4. Проверяем обтекание данной строки относитально плавающих объектов
        //-------------------------------------------------------------------------------------------------------------

        var Left   = ( 0 !== CurLine ? this.X + ParaPr.Ind.Left : this.X + ParaPr.Ind.Left + ParaPr.Ind.FirstLine );
        var Right  = this.XLimit - ParaPr.Ind.Right;

        var PageFields = this.Parent.Get_PageFields( this.PageNum + CurPage );
        var Ranges2;

        if ( true === this.Use_Wrap() )
            Ranges2 = this.Parent.CheckRange( Left, Top, Right, Bottom, Top2, Bottom2, PageFields.X, PageFields.XLimit, this.PageNum + CurPage, true );
        else
            Ranges2 = [];

        // Проверяем совпали ли промежутки. Если совпали, тогда данная строчка рассчитана верно, и мы переходим к
        // следующей, если нет, тогда заново рассчитываем данную строчку, но с новыми промежутками.
        // Заметим, что тут возможен случай, когда Ranges2 меньше, чем Ranges, такое может случится при повторном
        // обсчете строки. (После первого расчета мы выяснили что Ranges < Ranges2, при повторном обсчете строки, т.к.
        // она стала меньше, то у нее и рассчитанная высота могла уменьшиться, а значит Ranges2 могло оказаться
        // меньше чем Ranges). В таком случае не надо делать повторный пересчет, иначе будет зависание.
        if ( -1 == FlowObjects_CompareRanges( Ranges, Ranges2 ) && true === FlowObjects_CheckInjection( Ranges, Ranges2 ) && false === bBreakPageLineEmpty )
        {
            // Выставляем новые отрезки обтекания и сообщаем, что надо заново персчитать данную строку
            PRS.Ranges       = Ranges2;
            PRS.RangesCount  = Ranges2.length;
            PRS.RecalcResult = recalcresult_CurLine;

            if ( true === this.Lines[CurLine].RangeY )
                PRS.RangeY = true;
            
            return;
        }

        //-------------------------------------------------------------------------------------------------------------
        // 5. Выставляем вертикальное смещение данной строки
        //-------------------------------------------------------------------------------------------------------------
        if ( true === PRS.NewPage )
        {
            // Если это последний элемент параграфа, тогда нам не надо переносить текущий параграф
            // на новую страницу. Нам надо выставить границы так, чтобы следующий параграф начинался
            // с новой страницы.


            // Здесь проверяем специальный случай, когда у нас после PageBreak в параграфе ничего не идет кроме
            // плавающих объектов. В такой ситуации мы располагаем эти объекты на текущей странице (см. DemoHyden v2).

            if ( true === this.Check_BreakPageEnd( PRS.PageBreak ) )
            {
                PRS.PageBreak.Flags.NewLine = false;
                PRS.ExtendBoundToBottom     = true;
                PRS.SkipPageBreak           = true;
                PRS.RecalcResult            = recalcresult_CurLine;
                return;
            }

            if ( true === this.Lines[CurLine].RangeY )
            {
                this.Lines[CurLine].Y = PRS.Y - this.Pages[CurPage].Y;
            }
            else
            {
                if ( CurLine > 0 )
                {
                    // Первая линия на странице не должна двигаться
                    if ( CurLine != this.Pages[CurPage].FirstLine )
                        PRS.Y += this.Lines[CurLine - 1].Metrics.Descent + this.Lines[CurLine - 1].Metrics.LineGap +  this.Lines[CurLine].Metrics.Ascent;

                    this.Lines[CurLine].Y = PRS.Y - this.Pages[CurPage].Y;
                }
                else
                    this.Lines[0].Y = 0;
            }

            this.Pages[CurPage].Set_EndLine( CurLine );
            PRS.RecalcResult = recalcresult_NextPage;
            return;
        }
        else
        {
            if ( true === this.Lines[CurLine].RangeY )
            {
                this.Lines[CurLine].Y = PRS.Y - this.Pages[CurPage].Y;
            }
            else
            {
                if ( CurLine > 0 )
                {
                    // Первая линия на странице не должна двигаться
                    if ( CurLine != this.Pages[CurPage].FirstLine && ( true === PRS.End || true !== PRS.EmptyLine || RangesCount <= 0 ) )
                        PRS.Y += this.Lines[CurLine - 1].Metrics.Descent + this.Lines[CurLine - 1].Metrics.LineGap +  this.Lines[CurLine].Metrics.Ascent;

                    this.Lines[CurLine].Y = PRS.Y - this.Pages[CurPage].Y;
                }
                else
                    this.Lines[0].Y = 0;
            }
        }

        //-------------------------------------------------------------------------------------------------------------
        // 6. Последние проверки
        //-------------------------------------------------------------------------------------------------------------
        
        // Такое случается, когда у нас после пересчета Flow картинки, место к которому она была привязана перешло на
        // следующую страницу.
        if ( PRS.RecalcResult === recalcresult_NextPage )
            return;
        
        if ( true !== PRS.End )
        {
            // Если строка пустая в следствии того, что у нас было обтекание, тогда мы не добавляем новую строку,
            // а просто текущую смещаем ниже.
            if ( true === PRS.EmptyLine && RangesCount > 0 )
            {
                // Найдем верхнюю точку объектов обтекания (т.е. так чтобы при новом обсчете не учитывался только
                // этот объект, заканчивающийся выше всех)

                var RangesMaxY = Ranges[0].Y1;
                for ( var Index = 1; Index < Ranges.length; Index++ )
                {
                    if ( RangesMaxY > Ranges[Index].Y1 )
                        RangesMaxY = Ranges[Index].Y1;
                }

                if ( Math.abs(RangesMaxY - PRS.Y) < 0.001  )
                    PRS.Y = RangesMaxY + 1; // смещаемся по 1мм
                else
                    PRS.Y = RangesMaxY + 0.001; // Добавляем 0.001, чтобы избавиться от погрешности

                // Отмечаем, что данная строка переносится по Y из-за обтекания
                PRS.RangeY = true;

                // Пересчитываем заново данную строку
                PRS.Reset_Ranges();
                PRS.RecalcResult = recalcresult_CurLine;

                return;
            }

            if ( true === PRS.ForceNewPage )
            {
                this.Pages[CurPage].Set_EndLine( CurLine - 1 );

                if ( 0 === CurLine )
                {
                    this.Lines[-1] = new CParaLine();
                    this.Lines[-1].Set_EndPos( LineStart_Pos - 1, this );
                }

                PRS.RecalcResult = recalcresult_NextPage;
                return;
            }
        }
        else
        {           
            // В последней строке могут быть заполнены не все отрезки обтекания
            for ( var TempRange = CurRange + 1; TempRange <= RangesCount; TempRange++ )
                this.Lines[CurLine].Set_RangeStartPos( TempRange, Pos );

            // Проверим висячую строку
            if ( true === ParaPr.WidowControl && CurLine === this.Pages[CurPage].StartLine && CurLine >= 1 )
            {
                // Проверим не встречается ли в предыдущей строке BreakPage, если да, тогда не учитываем WidowControl
                var bBreakPagePrevLine = false;

                var __StartLine = ( 2 === CurLine ? CurLine - 2 : CurLine - 1 );
                var __EndLine   = CurLine - 1;

                for ( var __CurLine = __StartLine; __CurLine <= __EndLine; __CurLine++ )
                {
                    if ( true === this.Check_BreakPageInLine( __CurLine ) )
                    {
                        bBreakPagePrevLine = true;
                        break;
                    }
                }

                if ( this.Parent instanceof CDocument && true === this.Parent.RecalcInfo.Can_RecalcObject() && false === bBreakPagePrevLine && ( 1 === CurPage && null != this.Get_DocumentPrev() ) && this.Lines[CurLine - 1].Ranges.length <= 1 )
                {
                    this.Parent.RecalcInfo.Set_WidowControl(this, ( CurLine > 2 ? CurLine - 1 : 0 ) ); // Если у нас в параграфе 3 строки, тогда сразу начинаем параграф с новой строки
                    PRS.RecalcResult = recalcresult_PrevPage;
                    return;
                }
            }

            // Специальный случай с PageBreak, когда после самого PageBreak ничего нет в параграфе
            if ( true === PRS.ExtendBoundToBottom )
            {
                this.Pages[CurPage].Bounds.Bottom = this.Pages[CurPage].YLimit;

                // Если у нас нумерация относится к знаку конца параграфа, тогда в такой
                // ситуации не рисуем нумерацию у такого параграфа.
                if ( para_End === this.Numbering.Item.Type )
                {
                    this.Numbering.Item  = null;
                    this.Numbering.Run   = null;
                    this.Numbering.Line  = -1;
                    this.Numbering.Range = -1;
                }
            }

            this.Pages[CurPage].Set_EndLine( CurLine );

            PRS.RecalcResult = recalcresult_NextElement;
        }
    },

    Recalculate_Set_RangeEndPos : function(PRS, PRP, Depth)
    {
        var CurLine  = PRS.Line;
        var CurRange = PRS.Range;
        var CurPos   = PRP.Get(Depth);

        // Сначала выставляем конечную позицию у внутреннего класса и только потом у текущего,
        // потому что на выставлении конечной позиции последнего отрезка происходит пересчет пробелов и слов.

        this.Content[CurPos].Recalculate_Set_RangeEndPos(PRS, PRP, Depth + 1);
        this.Lines[CurLine].Set_RangeEndPos( CurRange, CurPos );
    },

    Recalculate_Lines_Width : function(CurPage)
    {
        var StartLine = this.Pages[CurPage].StartLine;
        var EndLine   = this.Pages[CurPage].EndLine;

        var PRSC = this.m_oPRSC;

        for ( var CurLine = StartLine; CurLine <= EndLine; CurLine++ )
        {
            var Line = this.Lines[CurLine];
            var RangesCount = Line.Ranges.length;

            for ( var CurRange = 0; CurRange < RangesCount; CurRange++ )
            {
                var Range = Line.Ranges[CurRange];
                var StartPos = Range.StartPos;
                var EndPos   = Range.EndPos;

                PRSC.Reset( this, Range );

                if ( true === this.Numbering.Check_Range(CurRange, CurLine) )
                    PRSC.Range.W += this.Numbering.WidthVisible;

                for ( var Pos = StartPos; Pos <= EndPos; Pos++ )
                {
                    var Item = this.Content[Pos];
                    Item.Recalculate_Range_Width( PRSC, CurLine, CurRange );
                }
            }
        }
    },

    Recalculate_Lines_Align : function(PRSW, CurPage, ParaPr, Fast)
    {
        // Здесь мы пересчитываем ширину пробелов (и в особенных случаях дополнительное
        // расстояние между символами) с учетом прилегания параграфа.
        // 1. Если align = left, тогда внутри каждого промежутка текста выравниваем его
        //    к левой границе промежутка.
        // 2. Если align = right, тогда внутри каждого промежутка текста выравниваем его
        //    к правой границе промежутка.
        // 3. Если align = center, тогда внутри каждого промежутка текста выравниваем его
        //    по центру промежутка.
        // 4. Если align = justify, тогда
        //    4.1 Если внутри промежутка ровно 1 слово.
        //        4.1.1 Если промежуток в строке 1 и слово занимает почти всю строку,
        //              добавляем в слове к каждой букве дополнительное расстояние между
        //              символами, чтобы ширина слова совпала с шириной строки.
        //        4.1.2 Если промежуток первый, тогда слово приставляем к левой границе
        //              промежутка
        //        4.1.3 Если промежуток последний, тогда приставляем слово к правой
        //              границе промежутка
        //        4.1.4 Если промежуток ни первый, ни последний, тогда ставим слово по
        //              середине промежутка
        //    4.2 Если слов больше 1, тогда, исходя из количества пробелов между словами в
        //        промежутке, увеличиваем их на столько, чтобы правая граница последнего
        //        слова совпала с правой границей промежутка

        var StartLine = this.Pages[CurPage].StartLine;
        var EndLine   = this.Pages[CurPage].EndLine;
        var LinesCount = this.Lines.length;

        var PRSA = this.m_oPRSA;
        PRSA.Paragraph  = this;
        PRSA.LastW      = 0;
        PRSA.RecalcFast = Fast;

        for ( var CurLine = StartLine; CurLine <= EndLine; CurLine++ )
        {
            var Line = this.Lines[CurLine];
            var RangesCount = Line.Ranges.length;

            for ( var CurRange = 0; CurRange < RangesCount; CurRange++ )
            {
                var Range = Line.Ranges[CurRange];

                var JustifyWord  = 0;
                var JustifySpace = 0;
                var RangeWidth   = Range.XEnd - Range.X;

                var X = 0;
                
                // Если данный отрезок содержит только формулу, тогда прилегание данного отрезка определяется формулой
                var ParaMath = this.Check_Range_OnlyMath(CurRange, CurLine);
                if ( null !== ParaMath )
                {
                    var Math_Jc = ParaMath.Jc;
                    
                    var Math_X      = ( 1 === RangesCount ? this.Pages[CurPage].X : Range.X );
                    var Math_XLimit = ( 1 === RangesCount ? this.Pages[CurPage].XLimit : Range.XEnd );
                    
                    X = Math.max( Math_X +  (Math_XLimit + Math_X - ParaMath.Width) / 2, Math_X );
                }
                else
                {
                    // RangeWidth - ширина всего пространства в данном отрезке, а Range.W - ширина занимаемого пространства
                    switch (ParaPr.Jc)
                    {
                        case align_Left :
                        {
                            X = Range.X;
                            break;
                        }
                        case align_Right:
                        {
                            X = Math.max(Range.X +  RangeWidth - Range.W, Range.X);
                            break;
                        }
                        case align_Center:
                        {
                            X = Math.max(Range.X + (RangeWidth - Range.W) / 2, Range.X);
                            break;
                        }
                        case align_Justify:
                        {
                            X = Range.X;

                            if ( 1 == Range.Words )
                            {
                                if ( 1 == RangesCount && this.Lines.length > 1 )
                                {
                                    // Либо слово целиком занимает строку, либо не целиком, но разница очень мала
                                    if ( RangeWidth - Range.W <= 0.05 * RangeWidth && Range.Letters > 1 )
                                        JustifyWord = (RangeWidth -  Range.W) / (Range.Letters - 1);
                                }
                                else if ( 0 == CurRange || ( CurLine == this.Lines.length - 1 && CurRange == RangesCount - 1 ) )
                                {
                                    // Ничего не делаем (выравниваем текст по левой границе)
                                }
                                else if ( CurRange == RangesCount - 1 )
                                {
                                    X = Range.X +  RangeWidth - Range.W;
                                }
                                else
                                {
                                    X = Range.X + (RangeWidth - Range.W) / 2;
                                }
                            }
                            else
                            {
                                // TODO: Переделать проверку последнего отрезка в последней строке (нужно выставлять флаг когда пришел PRS.End в отрезке)

                                // Последний промежуток последней строки не надо растягивать по ширине.
                                if ( Range.Spaces > 0 && ( CurLine != this.Lines.length - 1 || CurRange != this.Lines[CurLine].Ranges.length - 1 ) )
                                    JustifySpace = (RangeWidth - Range.W) / Range.Spaces;
                                else
                                    JustifySpace = 0;
                            }

                            break;
                        }
                        default:
                        {
                            X = Range.X;
                            break;
                        }
                    }

                    // В последнем отрезке последней строки не делаем текст "по ширине"
                    if ( CurLine === this.ParaEnd.Line && CurRange === this.ParaEnd.Range )
                    {
                        JustifyWord  = 0;
                        JustifySpace = 0;
                    }
                }                                                

                PRSA.X    = X;
                PRSA.Y    = this.Pages[CurPage].Y + this.Lines[CurLine].Y;
                PRSA.XEnd = Range.XEnd;
                PRSA.JustifyWord   = JustifyWord;
                PRSA.JustifySpace  = JustifySpace;
                PRSA.SpacesCounter = Range.Spaces;
                PRSA.SpacesSkip    = Range.SpacesSkip;
                PRSA.LettersSkip   = Range.LettersSkip;
                PRSA.RecalcResult  = recalcresult_NextElement;

                this.Lines[CurLine].Ranges[CurRange].XVisible = X;

                if ( 0 === CurRange )
                    this.Lines[CurLine].X = X - PRSW.XStart;

                var StartPos = Range.StartPos;
                var EndPos   = Range.EndPos;

                if ( true === this.Numbering.Check_Range(CurRange, CurLine) )
                    PRSA.X += this.Numbering.WidthVisible;

                for ( var Pos = StartPos; Pos <= EndPos; Pos++ )
                {
                    var Item = this.Content[Pos];
                    Item.Recalculate_Range_Spaces(PRSA, CurLine, CurRange, CurPage);

                    if ( recalcresult_NextElement !== PRSA.RecalcResult )
                        return PRSA.RecalcResult;
                }
            }
        }

        return recalcresult_NextElement;
    },
    
    Check_Range_OnlyMath : function(CurRange, CurLine)
    {
        var StartPos = this.Lines[CurLine].Ranges[CurRange].StartPos;
        var EndPos   = this.Lines[CurLine].Ranges[CurRange].EndPos;
        var Checker  = new CParagraphMathRangeChecker();

        for (var Pos = StartPos; Pos <= EndPos; Pos++)
        {
            this.Content[Pos].Check_Range_OnlyMath(Checker, CurRange, CurLine);

            if (false === Checker.Result)
                break;
        }
        
        if ( true !== Checker.Result || null === Checker.Math || true !== Checker.Math.MathPara )
            return null;
                
        return Checker.Math;
    },
    
    Check_MathPara : function(MathPos)
    {
        if (undefined === this.Content[MathPos] || para_Math !== this.Content[MathPos].Type)
            return false;
        
        var MathParaChecker = new CParagraphMathParaChecker();
        
        // Нам надо пробежаться впереди назад и найти ближайшие элементы.
        MathParaChecker.Direction = -1;
        for ( var CurPos = MathPos - 1; CurPos >= 0; CurPos-- )
        {
            if ( this.Content[CurPos].Check_MathPara )
            {
                this.Content[CurPos].Check_MathPara( MathParaChecker );

                if ( false !== MathParaChecker.Found )
                    break;
            }
        }
        
        if ( true !== MathParaChecker.Result )
            return false;
        
        MathParaChecker.Direction = 1;
        MathParaChecker.Found     = false;
        
        var Count = this.Content.length;
        for ( var CurPos = MathPos + 1; CurPos < Count; CurPos++ )
        {
            if ( this.Content[CurPos].Check_MathPara )
            {
                this.Content[CurPos].Check_MathPara( MathParaChecker );

                if ( false !== MathParaChecker.Found )
                    break;
            }            
        }
        
        if ( true !== MathParaChecker.Result )
            return false;
        
        return true;
    },

    Get_EndInfo : function()
    {
        var PagesCount = this.Pages.length;

        if ( PagesCount > 0 )
            return this.Pages[PagesCount - 1].EndInfo.Copy();
        else
            return null;
    },

    Get_EndInfoByPage : function(CurPage)
    {
        // Здесь может приходить отрицательное значение

        if ( CurPage < 0 )
            return this.Parent.Get_PrevElementEndInfo(this);
        else
            return this.Pages[CurPage].EndInfo.Copy();
    },

    Recalculate_PageEndInfo : function(PRSW, CurPage)
    {
        var PrevInfo = ( 0 === CurPage ? this.Parent.Get_PrevElementEndInfo( this ) : this.Pages[CurPage - 1].EndInfo.Copy() );

        var PRSI = this.m_oPRSI;

        PRSI.Reset( PrevInfo );

        var StartLine = this.Pages[CurPage].StartLine;
        var EndLine   = this.Pages[CurPage].EndLine;
        var LinesCount = this.Lines.length;

        for ( var CurLine = StartLine; CurLine <= EndLine; CurLine++ )
        {
            var RangesCount = this.Lines[CurLine].Ranges.length;
            for ( var CurRange = 0; CurRange < RangesCount; CurRange++ )
            {
                var StartPos = this.Lines[CurLine].Ranges[CurRange].StartPos;
                var EndPos   = this.Lines[CurLine].Ranges[CurRange].EndPos;
                for ( var CurPos = StartPos; CurPos <= EndPos; CurPos++ )
                {
                    this.Content[CurPos].Recalculate_PageEndInfo( PRSI, CurLine, CurRange );
                }
            }
        }

        this.Pages[CurPage].EndInfo.Comments = PRSI.Comments;

        if (PRSW)
            this.Pages[CurPage].EndInfo.RunRecalcInfo = PRSW.RunRecalcInfoBreak;
    },

    Update_EndInfo : function()
    {
        for (var CurPage = 0, PagesCount = this.Pages.length; CurPage < PagesCount; CurPage++)
        {
            this.Recalculate_PageEndInfo(null, CurPage);
        }
    },

    Recalculate_Drawing_AddPageBreak : function(CurLine, CurPage, RemoveDrawings)
    {
        if ( true === RemoveDrawings )
        {
            // Мы должны из соответствующих FlowObjects удалить все Flow-объекты, идущие до этого места в параграфе
            for ( var TempPage = 0; TempPage <= CurPage; TempPage++ )
            {
                var DrawingsLen = this.Pages[TempPage].Drawings.length;
                for ( var CurPos = 0; CurPos < DrawingsLen; CurPos++ )
                {
                    var Item = this.Pages[TempPage].Drawings[CurPos];
                    DrawingObjects.removeById( Item.PageNum, Item.Get_Id() );
                }

                this.Pages[TempPage].Drawings = [];
            }
        }

        this.Pages[CurPage].Set_EndLine( CurLine - 1 );

        if ( 0 === CurLine )
            this.Lines[-1] = new CParaLine(0);
    },

    /**
     * Проверяем есть ли в параграфе встроенные PageBreak
     * @return {bool}
     */
    Check_PageBreak : function()
    {
        //TODO: возможно стоит данную проверку проводить во время добавления/удаления элементов из параграфа
        var Count = this.Content.length;
        for (var Pos = 0; Pos < Count; Pos++)
        {
            if (true === this.Content[Pos].Check_PageBreak())
                return true;
        }

        return false;
    },

    Check_BreakPageInLine : function(CurLine)
    {
        var RangesCount = this.Lines[CurLine].Ranges.length;
        for ( var CurRange = 0; CurRange < RangesCount; CurRange++ )
        {
            var StartPos = this.Lines[CurLine].Ranges[CurRange].StartPos;
            var EndPos   = this.Lines[CurLine].Ranges[CurRange].EndPos;

            for ( var CurPos = StartPos; CurPos <= EndPos; CurPos++ )
            {
                var Element = this.Content[CurPos];

                if ( true === Element.Check_BreakPageInRange( CurLine, CurRange ) )
                    return true;
            }
        }

        return false;
    },

    Check_BreakPageEnd : function(Item)
    {
        var PBChecker = new CParagraphCheckPageBreakEnd( Item );

        var ContentLen = this.Content.length;
        for ( var CurPos = 0; CurPos < ContentLen; CurPos++ )
        {
            var Element = this.Content[CurPos];

            if ( true !== Element.Check_BreakPageEnd(PBChecker) )
                return false;
        }

        return true;
    },

    // Пересчитываем заданную позицию элемента или текущую позицию курсора.
    Internal_Recalculate_CurPos : function(Pos, UpdateCurPos, UpdateTarget, ReturnTarget)
    {
        if ( this.Lines.length <= 0 )
            return { X : 0, Y : 0, Height : 0, Internal : { Line : 0, Page : 0, Range : 0 } };

        var LinePos = this.Get_CurrentParaPos();

        var CurLine  = LinePos.Line;
        var CurRange = LinePos.Range;
        var CurPage  = LinePos.Page;

        // Если в текущей позиции явно указана строка
        if ( -1 != this.CurPos.Line )
        {
            CurLine  = this.CurPos.Line;
            CurRange = this.CurPos.Range;
        }

        var X = this.Lines[CurLine].Ranges[CurRange].XVisible;
        var Y = this.Pages[CurPage].Y + this.Lines[CurLine].Y;

        var StartPos = this.Lines[CurLine].Ranges[CurRange].StartPos;
        var EndPos   = this.Lines[CurLine].Ranges[CurRange].EndPos;

        if ( true === this.Numbering.Check_Range( CurRange, CurLine ) )
            X += this.Numbering.WidthVisible;

        for ( var CurPos = StartPos; CurPos <= EndPos; CurPos++ )
        {
            var Item = this.Content[CurPos];
            var Res = Item.Recalculate_CurPos( X, Y, (CurPos === this.CurPos.ContentPos ? true : false), CurRange, CurLine, CurPage, UpdateCurPos, UpdateTarget, ReturnTarget );

            if ( CurPos === this.CurPos.ContentPos )
                return Res;
            else
                X = Res.X;
        }

        return { X : X, Y : Y, PageNum : CurPage + this.Get_StartPage_Absolute(), Internal : { Line : CurLine, Page : CurPage, Range : CurRange } };
    },

    Internal_UpdateCurPos : function(X, Y, CurPos, CurLine, CurPage, UpdateTarget)
    {
        this.CurPos.X        = X;
        this.CurPos.Y        = Y;
        this.CurPos.PagesPos = CurPage;

        if ( true === UpdateTarget )
        {
            var CurTextPr = this.Internal_CalculateTextPr(CurPos);
            g_oTextMeasurer.SetTextPr( CurTextPr, this.Get_Theme());
            g_oTextMeasurer.SetFontSlot( fontslot_ASCII, CurTextPr.Get_FontKoef() );
            var Height    = g_oTextMeasurer.GetHeight();
            var Descender = Math.abs( g_oTextMeasurer.GetDescender() );
            var Ascender  = Height - Descender;

            this.DrawingDocument.SetTargetSize( Height );

            if ( true === CurTextPr.Color.Auto )
            {
                // Выясним какая заливка у нашего текста
                var Pr = this.Get_CompiledPr();
                var BgColor = undefined;
                if ( undefined !== Pr.ParaPr.Shd && shd_Nil !== Pr.ParaPr.Shd.Value )
                {
                    if(Pr.ParaPr.Shd.Unifill)
                    {
                        Pr.ParaPr.Shd.Unifill.check(this.Get_Theme(), this.Get_ColorMap());
                        var RGBA = Pr.ParaPr.Shd.Unifill.getRGBAColor();
                        BgColor = new CDocumentColor(RGBA.R, RGBA.G, RGBA.B, false);
                    }
                    else
                    {
                        BgColor = Pr.ParaPr.Shd.Color;
                    }
                }
                else
                {
                    // Нам надо выяснить заливку у родительского класса (возможно мы находимся в ячейке таблицы с забивкой)
                    BgColor = this.Parent.Get_TextBackGroundColor();
                }

                // Определим автоцвет относительно заливки
                var AutoColor = ( undefined != BgColor && false === BgColor.Check_BlackAutoColor() ? new CDocumentColor( 255, 255, 255, false ) : new CDocumentColor( 0, 0, 0, false ) );
                this.DrawingDocument.SetTargetColor( AutoColor.r, AutoColor.g, AutoColor.b );
            }
            else
                this.DrawingDocument.SetTargetColor( CurTextPr.Color.r, CurTextPr.Color.g, CurTextPr.Color.b );

            var TargetY = Y - Ascender - CurTextPr.Position;
            switch( CurTextPr.VertAlign )
            {
                case vertalign_SubScript:
                {
                    TargetY -= CurTextPr.FontSize * g_dKoef_pt_to_mm * vertalign_Koef_Sub;
                    break;
                }
                case vertalign_SuperScript:
                {
                    TargetY -= CurTextPr.FontSize * g_dKoef_pt_to_mm * vertalign_Koef_Super;
                    break;
                }
            }

            var Page_Abs = this.Get_StartPage_Absolute() + CurPage;
            this.DrawingDocument.UpdateTarget( X, TargetY, Page_Abs );

            // TODO: Тут делаем, чтобы курсор не выходил за границы буквицы. На самом деле, надо делать, чтобы
            //       курсор не выходил за границы строки, но для этого надо делать обрезку по строкам, а без нее
            //       такой вариант будет смотреться плохо.
            if ( undefined != this.Get_FramePr() )
            {
                var __Y0 = TargetY, __Y1 = TargetY + Height;
                var ___Y0 = this.Pages[CurPage].Y + this.Lines[CurLine].Top;
                var ___Y1 = this.Pages[CurPage].Y + this.Lines[CurLine].Bottom;

                var __Y0 = Math.max( __Y0, ___Y0 );
                var __Y1 = Math.min( __Y1, ___Y1 );

                this.DrawingDocument.SetTargetSize( __Y1 - __Y0 );
                this.DrawingDocument.UpdateTarget( X, __Y0, Page_Abs );
            }
        }
    },

    // Можно ли объединить границы двух параграфов с заданными настройками Pr1, Pr2
    Internal_CompareBrd : function(Pr1, Pr2)
    {
        // Сначала сравним правую и левую границы параграфов
        var Left_1  = Math.min( Pr1.Ind.Left, Pr1.Ind.Left + Pr1.Ind.FirstLine );
        var Right_1 = Pr1.Ind.Right;
        var Left_2  = Math.min( Pr2.Ind.Left, Pr2.Ind.Left + Pr2.Ind.FirstLine );
        var Right_2 = Pr2.Ind.Right;

        if ( Math.abs( Left_1 - Left_2 ) > 0.001 || Math.abs( Right_1 - Right_2 ) > 0.001 )
            return false;

        if ( false === Pr1.Brd.Top.Compare( Pr2.Brd.Top )   || false === Pr1.Brd.Bottom.Compare( Pr2.Brd.Bottom ) ||
            false === Pr1.Brd.Left.Compare( Pr2.Brd.Left ) || false === Pr1.Brd.Right.Compare( Pr2.Brd.Right )   ||
            false === Pr1.Brd.Between.Compare( Pr2.Brd.Between ) )
            return false;

        return true;
    },

    Internal_GetTabPos : function(X, ParaPr, CurPage)
    {
        var PRS = this.m_oPRSW;
        var PageStart = this.Parent.Get_PageContentStartPos( this.PageNum + CurPage, this.Index );
        if ( undefined != this.Get_FramePr() )
            PageStart.X = 0;
        else if ( PRS.RangesCount > 0 && Math.abs(PRS.Ranges[0].X0 - PageStart.X) < 0.001 )
            PageStart.X = PRS.Ranges[0].X1;

        // Если у данного параграфа есть табы, тогда ищем среди них
        var TabsCount = ParaPr.Tabs.Get_Count();

        // Добавим в качестве таба левую границу
        var TabsPos = [];
        var bCheckLeft = true;
        for ( var Index = 0; Index < TabsCount; Index++ )
        {
            var Tab = ParaPr.Tabs.Get(Index);
            var TabPos = Tab.Pos + PageStart.X;

            // Здесь 0.001 убавляется из-за замечания ниже
            if ( true === bCheckLeft && TabPos > PageStart.X + ParaPr.Ind.Left - 0.001 )
            {
                TabsPos.push( new CParaTab(tab_Left, ParaPr.Ind.Left - 0.001) );
                bCheckLeft = false;
            }

            if ( tab_Clear != Tab.Value )
                TabsPos.push( Tab );
        }

        // Здесь 0.001 убавляется из-за замечания ниже
        if ( true === bCheckLeft )
            TabsPos.push( new CParaTab(tab_Left, ParaPr.Ind.Left - 0.001) );

        TabsCount = TabsPos.length;

        var Tab = null;
        for ( var Index = 0; Index < TabsCount; Index++ )
        {
            var TempTab = TabsPos[Index];

            // TODO: Пока здесь сделаем поправку на погрешность. Когда мы сделаем так, чтобы все наши значения хранились
            //       в тех же единицах, что и в формате Docx, тогда и здесь можно будет вернуть строгое равенство (см. баг 22586)
            if ( X < TempTab.Pos + PageStart.X + 0.001 )
            {
                Tab = TempTab;
                break;
            }
        }

        var NewX = 0;

        // Если табов нет, либо их позиции левее текущей позиции ставим таб по умолчанию
        if ( null === Tab )
        {
            if ( X < PageStart.X + ParaPr.Ind.Left )
                NewX = PageStart.X + ParaPr.Ind.Left;
            else
            {
                NewX = PageStart.X;
                while ( X >= NewX - 0.001 )
                    NewX += Default_Tab_Stop;
            }
        }
        else
        {
            // Здесь 0.001 добавляется из-за замечания выше
            NewX = Tab.Pos + PageStart.X + 0.001;
        }

        return { NewX : NewX, TabValue : ( null === Tab ? tab_Left : Tab.Value ) };
    },

    // Проверяем не пустые ли границы
    Internal_Is_NullBorders : function (Borders)
    {
        if ( border_None != Borders.Top.Value  || border_None != Borders.Bottom.Value ||
            border_None != Borders.Left.Value || border_None != Borders.Right.Value  ||
            border_None != Borders.Between.Value )
            return false;

        return true;
    },

    Internal_Check_Ranges : function(CurLine, CurRange)
    {
        var Ranges = this.Lines[CurLine].Ranges;
        var RangesCount = Ranges.length;

        if ( RangesCount <= 1 )
            return true;
        else if ( 2 === RangesCount )
        {
            var Range0 = Ranges[0];
            var Range1 = Ranges[1];

            if ( Range0.XEnd - Range0.X < 0.001 && 1 === CurRange && Range1.XEnd - Range1.X >= 0.001 )
                return true;
            else if ( Range1.XEnd - Range1.X < 0.001 && 0 === CurRange && Range0.XEnd - Range0.X >= 0.001 )
                return true;
            else
                return false
        }
        else if ( 3 === RangesCount && 1 === CurRange )
        {
            var Range0 = Ranges[0];
            var Range2 = Ranges[2];

            if ( Range0.XEnd - Range0.X < 0.001 && Range2.XEnd - Range2.X < 0.001 )
                return true;
            else
                return false;
        }
        else
            return false;
    },

    Internal_Get_NumberingTextPr : function()
    {
        var Pr     = this.Get_CompiledPr();
        var ParaPr = Pr.ParaPr;
        var NumPr  = ParaPr.NumPr;

        if ( undefined === NumPr || undefined === NumPr.NumId || 0 === NumPr.NumId || "0" === NumPr.NumId )
            return new CTextPr();

        var Numbering = this.Parent.Get_Numbering();
        var NumLvl    = Numbering.Get_AbstractNum( NumPr.NumId ).Lvl[NumPr.Lvl];
        var NumTextPr = this.Get_CompiledPr2(false).TextPr.Copy();
        NumTextPr.Merge( this.TextPr.Value );
        NumTextPr.Merge( NumLvl.TextPr );

        NumTextPr.FontFamily.Name = NumTextPr.RFonts.Ascii.Name;

        return NumTextPr;
    },

    Is_EmptyRange : function(CurLine, CurRange)
    {
        var Line  = this.Lines[CurLine];
        var Range = Line.Ranges[CurRange];

        var StartPos = Range.StartPos;
        var EndPos   = Range.EndPos;

        for ( var CurPos = StartPos; CurPos <= EndPos; CurPos++ )
        {
            if ( false === this.Content[CurPos].Is_EmptyRange( CurLine, CurRange ) )
                return false;
        }

        return true;
    },

    Recalculate_Fast : function(SimpleChanges)
    {
        if ( true === this.Parent.Is_HdrFtr(false) )
            return -1;

        var Run = SimpleChanges[0].Class;

        var StartLine  = Run.StartLine;
        var StartRange = Run.StartRange;

        var StartPos = this.Lines[StartLine].Ranges[StartRange].StartPos;
        var EndPos   = this.Lines[StartLine].Ranges[StartRange].EndPos;

        var ParaPos = Run.Get_SimpleChanges_ParaPos(SimpleChanges);
        if ( null === ParaPos )
            return -1;

        var Line  = ParaPos.Line;
        var Range = ParaPos.Range;
        
        // TODO: Отключаем это ускорение в таблицах, т.к. в таблицах и так есть свое ускорение. Но можно и это ускорение 
        // подключить, для этого надо проверять изменились ли MinMax ширины и набираем ли мы в строке заголовков.
        if ( undefined === this.Parent || true === this.Parent.Is_TableCellContent() )
            return -1;

        // Если мы находимся в строке, которая была полностью перенесена из-за обтекания,  и мы добавляем пробел, или
        // удаляем символ, тогда нам запускать обычный пересчет, т.к. первое слово может начать убираться в промежутках
        // обтекания, которых у нас нет в отрезках строки
        if ( true === this.Lines[Line].RangeY )
        {
            // TODO: Сделать проверку на добавление пробела и удаление
            return -1;
        }
        
        // Если у нас есть PageBreak в строке, запускаем обычный пересчет, либо если это пустой параграф.
        if ( this.Lines[Line].LineInfo & 1 || (  this.Lines[Line].LineInfo & 2 &&  this.Lines[Line].LineInfo & 4 ) )
            return  -1;

        // Если у нас отрезок, в котором произошли изменения является отрезком с нумерацией, тогда надо запустить
        // обычный пересчет.
        var NumPr = this.Get_CompiledPr2(false).ParaPr.NumPr;
        if ( null !== this.Numbering.Item && ( Line < this.Numbering.Line || ( Line === this.Numbering.Line && Range <= this.Numbering.Range ) ) && ( undefined !== NumPr && undefined !== NumPr.NumId && 0 !== NumPr.NumId && "0" !== NumPr.NumId ) )
        {
            // TODO: Сделать проверку на само изменение, переместилась ли нумерация
            return -1;
        }
        
        if ( 0 === Line && 0 === Range && undefined !== this.Get_SectionPr() )
        {
            return -1;
        }
        
        // Если наш параграф является рамкой с авто шириной, тогда пересчитываем по обычному
        // TODO: Улучишить данную проверку
        if ( 1 === this.Lines.length && true !== this.Is_Inline() )
            return -1;
        
        // Мы должны пересчитать как минимум 3 отрезка: текущий, предыдущий и следующий, потому что при удалении элемента
        // или добавлении пробела первое слово в данном отрезке может убраться в предыдущем отрезке, и кроме того при
        // удалении возможен вариант, когда мы неправильно определили отрезок (т.е. более ранний взяли). Но возможен
        // вариант, при котором предыдущий или/и следующий отрезки - пустые, т.е. там нет ни одного текстового элемента
        // тогда мы начинаем проверять с отрезка, в котором есть хоть что-то.

        var PrevLine  = Line;
        var PrevRange = Range;

        while ( PrevLine >= 0 )
        {
            PrevRange--;

            if ( PrevRange < 0 )
            {
                PrevLine--;

                if ( PrevLine < 0 )
                    break;

                PrevRange = this.Lines[PrevLine].Ranges.length - 1;
            }

            if ( true === this.Is_EmptyRange( PrevLine, PrevRange ) )
                continue;
            else
                break;
        }

        if ( PrevLine < 0 )
        {
            PrevLine  = Line;
            PrevRange = Range;
        }

        var NextLine  = Line;
        var NextRange = Range;

        var LinesCount = this.Lines.length;

        while ( NextLine <= LinesCount - 1 )
        {
            NextRange++;

            if ( NextRange > this.Lines[NextLine].Ranges.length - 1 )
            {
                NextLine++

                if ( NextLine > LinesCount - 1 )
                    break;

                NextRange = 0;
            }

            if ( true === this.Is_EmptyRange( NextLine, NextRange ) )
                continue;
            else
                break;
        }

        if ( NextLine > LinesCount - 1 )
        {
            NextLine  = Line;
            NextRange = Range;
        }

        var CurLine  = PrevLine;
        var CurRange = PrevRange;

        var Result;
        while ( ( CurLine < NextLine ) || ( CurLine === NextLine && CurRange <= NextRange ) )
        {
            var TempResult = this.Recalculate_Fast_Range(CurLine, CurRange);
            if ( -1 === TempResult )
                return -1;

            if ( CurLine === Line && CurRange === Range )
                Result = TempResult;

            CurRange++;

            if ( CurRange > this.Lines[CurLine].Ranges.length - 1 )
            {
                CurLine++;
                CurRange = 0;
            }
        }

        // Во время пересчета сбрасываем привязку курсора к строке.
        this.CurPos.Line  = -1;
        this.CurPos.Range = -1;

        this.Internal_CheckSpelling();

        return Result;
    },

    Recalculate_Fast_Range : function(_Line, _Range)
    {
        var PRS = this.m_oPRSW;

        var XStart, YStart, XLimit, YLimit;

        // Определим номер страницы
        var CurLine  = _Line;
        var CurRange = _Range;
        var CurPage  = 0;

        var PagesLen = this.Pages.length;
        for ( var TempPage = 0; TempPage < PagesLen; TempPage++ )
        {
            var __Page = this.Pages[TempPage];
            if ( CurLine <= __Page.EndLine && CurLine >= __Page.FirstLine )
            {
                CurPage = TempPage;
                break;
            }
        }

        if ( -1 === CurPage )
            return -1;

        var ParaPr = this.Get_CompiledPr2( false).ParaPr;

        if ( 0 === CurPage )//|| ( undefined != this.Get_FramePr() && this.Parent instanceof CDocument ) )
        {
            XStart = this.X;
            YStart = this.Y;
            XLimit = this.XLimit;
            YLimit = this.YLimit;
        }
        else
        {
            var PageStart = this.Parent.Get_PageContentStartPos( this.PageNum + CurPage, this.Index );

            XStart = PageStart.X;
            YStart = PageStart.Y;
            XLimit = PageStart.XLimit;
            YLimit = PageStart.YLimit;
        }

        PRS.XStart = XStart;
        PRS.YStart = YStart;
        PRS.XLimit = XLimit - ParaPr.Ind.Right;
        PRS.YLimit = YLimit;

        // Обнуляем параметры PRS для строки и отрезка
        PRS.Reset_Line();

        PRS.Page  = 0;
        PRS.Line  = _Line;
        PRS.Range = _Range;

        PRS.RangesCount = this.Lines[CurLine].Ranges.length - 1;

        PRS.Paragraph = this;

        var RangesCount = PRS.RangesCount;

        var Line  = this.Lines[CurLine];
        var Range = Line.Ranges[CurRange];

        var StartPos = Range.StartPos;
        var EndPos   = Range.EndPos;

        // Обновляем состояние пересчета
        PRS.Reset_Range(Range.X, Range.XEnd);

        var ContentLen = this.Content.length;

        for ( var Pos = StartPos; Pos <= EndPos; Pos++ )
        {
            var Item = this.Content[Pos];

            if ( para_Math === Item.Type )
            {
                // TODO: Надо бы перенести эту проверку на изменение контента параграфа
                Item.MathPara = this.Check_MathPara(Pos);                
            }
            
            PRS.Update_CurPos( Pos, 0 );

            var SavedLines = Item.Save_RecalculateObject(true);

            Item.Recalculate_Range( PRS, ParaPr, 1 );

            if ( ( true === PRS.NewRange && Pos !== EndPos ) || ( Pos === EndPos && true !== PRS.NewRange ) )
                return -1;
            else if ( Pos === EndPos && true === PRS.NewRange && true === PRS.MoveToLBP )
            {
                Item.Recalculate_Set_RangeEndPos(PRS, PRS.LineBreakPos, 1);
            }

            // Нам нужно проверить только строку с номером CurLine
            if ( false === SavedLines.Compare( _Line, _Range, Item ) )
                return -1;

            Item.Load_RecalculateObject(SavedLines, this);
        }

        // Recalculate_Lines_Width
        var PRSC = this.m_oPRSC;

        var StartPos = Range.StartPos;
        var EndPos   = Range.EndPos;

        Range.Reset_Width();
        PRSC.Reset( this, Range );

        if ( true === this.Numbering.Check_Range(CurRange, CurLine) )
            PRSC.Range.W += this.Numbering.WidthVisible;

        for ( var Pos = StartPos; Pos <= EndPos; Pos++ )
        {
            var Item = this.Content[Pos];
            Item.Recalculate_Range_Width( PRSC, CurLine, CurRange );
        }
        //------------------------------------------------

        var RecalcResultAlign = this.Recalculate_Lines_Align(PRS, CurPage, ParaPr, true);

        if ( recalcresult_NextElement !== RecalcResultAlign )
            return -1;

        return this.Get_StartPage_Absolute() + CurPage;
    },

    Start_FromNewPage : function()
    {
        this.Pages.length = 1;

        // Добавляем разрыв страницы
        this.Pages[0].Set_EndLine( - 1 );
        this.Lines[-1] = new CParaLine(0);
        this.Lines[-1].Set_EndPos( - 1, this );
    },

    Reset_RecalculateCache : function()
    {

    },

    Recalculate_Page : function(_PageIndex)
    {
        this.Clear_NearestPosArray();

        // Во время пересчета сбрасываем привязку курсора к строке.
        this.CurPos.Line  = -1;
        this.CurPos.Range = -1;

        this.FontMap.NeedRecalc = true;

        this.Internal_CheckSpelling();

        var CurPage = _PageIndex - this.PageNum;
        var RecalcResult = this.Recalculate_Page__( CurPage );

        if ( true === this.Parent.RecalcInfo.WidowControlReset )
            this.Parent.RecalcInfo.Reset();

        return RecalcResult;
    },

    RecalculateCurPos : function()
    {
        this.Internal_Recalculate_CurPos( this.CurPos.ContentPos, true, true, false );
    },

    Recalculate_MinMaxContentWidth : function()
    {
        var MinMax = new CParagraphMinMaxContentWidth();

        var Count = this.Content.length;
        for ( var Pos = 0; Pos < Count; Pos++ )
        {
            var Item = this.Content[Pos];

            Item.Set_Paragraph( this );
            Item.Recalculate_MinMaxContentWidth( MinMax );
        }

        // добавляем 0.001, чтобы избавиться от погрешностей
        return { Min : ( MinMax.nMinWidth > 0 ?  MinMax.nMinWidth + 0.001 : 0 ), Max : ( MinMax.nMaxWidth > 0 ?  MinMax.nMaxWidth + 0.001 : 0 ) };
    },

    Draw : function(PageNum, pGraphics)
    {
        var CurPage = PageNum - this.PageNum;

        // Параграф начинается с новой страницы
        if ( this.Pages[CurPage].EndLine < 0 )
            return;

        var Pr = this.Get_CompiledPr();

        // Задаем обрезку, если данный параграф является рамкой
        if (true !== this.Is_Inline())
        {
            var FramePr = this.Get_FramePr();
            if (undefined != FramePr && this.Parent instanceof CDocument)
            {
                var PixelError = editor.WordControl.m_oLogicDocument.DrawingDocument.GetMMPerDot(1);
                var BoundsL = this.CalculatedFrame.L2 - PixelError;
                var BoundsT = this.CalculatedFrame.T2 - PixelError;
                var BoundsH = this.CalculatedFrame.H2 + 2 * PixelError;
                var BoundsW = this.CalculatedFrame.W2 + 2 * PixelError;

                pGraphics.SaveGrState();
                pGraphics.AddClipRect(BoundsL, BoundsT, BoundsW, BoundsH);
            }
        }

        // Выясним какая заливка у нашего текста

        var Theme    = this.Get_Theme();
        var ColorMap = this.Get_ColorMap();
        var BgColor = undefined;
        if ( undefined !== Pr.ParaPr.Shd && shd_Nil !== Pr.ParaPr.Shd.Value && true !== Pr.ParaPr.Shd.Color.Auto )
        {
            if(Pr.ParaPr.Shd.Unifill)
            {
                Pr.ParaPr.Shd.Unifill.check(this.Get_Theme(), this.Get_ColorMap());
                var RGBA = Pr.ParaPr.Shd.Unifill.getRGBAColor();
                BgColor = new CDocumentColor(RGBA.R, RGBA.G, RGBA.B, false);
            }
            else
            {
                BgColor = Pr.ParaPr.Shd.Color;
            }
        }
        else
        {
            // Нам надо выяснить заливку у родительского класса (возможно мы находимся в ячейке таблицы с забивкой)
            BgColor = this.Parent.Get_TextBackGroundColor();
        }

        
        // 1 часть отрисовки :
        //    Рисуем слева от параграфа знак, если данный параграф зажат другим пользователем
        this.Internal_Draw_1( CurPage, pGraphics, Pr );

        // 2 часть отрисовки :
        //    Добавляем специальный символ слева от параграфа, для параграфов, у которых стоит хотя бы
        //    одна из настроек: не разрывать абзац(KeepLines), не отрывать от следующего(KeepNext),
        //    начать с новой страницы(PageBreakBefore)
        this.Internal_Draw_2( CurPage, pGraphics, Pr );

        // 3 часть отрисовки :
        //    Рисуем заливку параграфа и различные выделения текста (highlight, поиск, совместное редактирование).
        //    Кроме этого рисуем боковые линии обводки параграфа.
        this.Internal_Draw_3( CurPage, pGraphics, Pr );

        // 4 часть отрисовки :
        //    Рисуем сами элементы параграфа
        this.Internal_Draw_4( CurPage, pGraphics, Pr, BgColor, Theme, ColorMap);

        // 5 часть отрисовки :
        //    Рисуем различные подчеркивания и зачеркивания.
        this.Internal_Draw_5( CurPage, pGraphics, Pr, BgColor );

        // 6 часть отрисовки :
        //    Рисуем верхнюю, нижнюю и промежуточную границы
        this.Internal_Draw_6( CurPage, pGraphics, Pr );

        // Убираем обрезку
        if ( undefined != FramePr && this.Parent instanceof CDocument  )
        {
            pGraphics.RestoreGrState();
        }
    },

    Internal_Draw_1 : function(CurPage, pGraphics, Pr)
    {
        // Если данный параграф зажат другим пользователем, рисуем соответствующий знак
        if(this.bFromDocument)
        {
            if ( locktype_None != this.Lock.Get_Type() )
            {
                if ( ( CurPage > 0 || false === this.Is_StartFromNewPage() || null === this.Get_DocumentPrev() ) )
                {
                    var X_min = -1 + Math.min( this.Pages[CurPage].X, this.Pages[CurPage].X + Pr.ParaPr.Ind.Left, this.Pages[CurPage].X + Pr.ParaPr.Ind.Left + Pr.ParaPr.Ind.FirstLine );
                    var Y_top = this.Pages[CurPage].Bounds.Top;
                    var Y_bottom = this.Pages[CurPage].Bounds.Bottom;

                    if ( true === editor.isCoMarksDraw || locktype_Mine != this.Lock.Get_Type() )
                        pGraphics.DrawLockParagraph(this.Lock.Get_Type(), X_min, Y_top, Y_bottom);
                }
            }
        }
    },

    Internal_Draw_2 : function(CurPage, pGraphics, Pr)
    {
        if ( this.bFromDocument && true === editor.ShowParaMarks && ( ( 0 === CurPage && ( this.Pages.length <= 1 || this.Pages[1].FirstLine > 0 ) ) || ( 1 === CurPage && this.Pages.length > 1 && this.Pages[1].FirstLine === 0 ) ) && ( true === Pr.ParaPr.KeepNext || true === Pr.ParaPr.KeepLines || true === Pr.ParaPr.PageBreakBefore ) )
        {
            var SpecFont = { FontFamily: { Name : "Arial", Index : -1 }, FontSize : 12, Italic : false, Bold : false };
            var SpecSym = String.fromCharCode( 0x25AA );
            pGraphics.SetFont( SpecFont );
            pGraphics.b_color1( 0, 0, 0, 255 );

            var CurLine  = this.Pages[CurPage].FirstLine;
            var CurRange = 0;
            var X = this.Lines[CurLine].Ranges[CurRange].XVisible;
            var Y = this.Pages[CurPage].Y + this.Lines[CurLine].Y;

            var SpecW = 2.5; // 2.5 mm
            var SpecX = Math.min( X, this.X ) - SpecW;

            pGraphics.FillText( SpecX, Y, SpecSym );
        }
    },

    Internal_Draw_3 : function(CurPage, pGraphics, Pr)
    {
        if(!this.bFromDocument)
            return;


        var bDrawBorders = this.Is_NeedDrawBorders();

        var PDSH = g_oPDSH;

        var _Page = this.Pages[CurPage];

        var DocumentComments = editor.WordControl.m_oLogicDocument.Comments;
        var Page_abs = CurPage + this.Get_StartPage_Absolute();

        var DrawComm = ( DocumentComments.Is_Use() && true != editor.isViewMode);
        var DrawFind = editor.WordControl.m_oLogicDocument.SearchEngine.Selection;
        var DrawColl = ( undefined === pGraphics.RENDERER_PDF_FLAG ? false : true );

        PDSH.Reset( this, pGraphics, DrawColl, DrawFind, DrawComm, this.Get_EndInfoByPage(CurPage - 1) );

        var StartLine = _Page.StartLine;
        var EndLine   = _Page.EndLine;

        for ( var CurLine = StartLine; CurLine <= EndLine; CurLine++ )
        {
            var _Line        = this.Lines[CurLine];
            var _LineMetrics = _Line.Metrics;

            var EndLinePos = _Line.EndPos;

            var Y0 = (_Page.Y + _Line.Y - _LineMetrics.Ascent);
            var Y1 = (_Page.Y + _Line.Y + _LineMetrics.Descent);
            if ( _LineMetrics.LineGap < 0 )
                Y1 += _LineMetrics.LineGap;

            var RangesCount = _Line.Ranges.length;
            for ( var CurRange = 0; CurRange < RangesCount; CurRange++ )
            {
                var _Range   = _Line.Ranges[CurRange];
                var X        = _Range.XVisible;
                var StartPos = _Range.StartPos;
                var EndPos   = _Range.EndPos;

                // Сначала проанализируем данную строку: в массивы aHigh, aColl, aFind
                // сохраним позиции начала и конца продолжительных одинаковых настроек
                // выделения, совместного редактирования и поиска соответственно.

                PDSH.Reset_Range( CurPage, CurLine, CurRange, X, Y0, Y1, _Range.SpacesSkip + _Range.Spaces );

                if ( true === this.Numbering.Check_Range(CurRange, CurLine) )
                {
                    var NumberingType = this.Numbering.Type;
                    var NumberingItem = this.Numbering;

                    if ( para_Numbering === NumberingType )
                    {
                        var NumPr = Pr.ParaPr.NumPr;
                        if ( undefined === NumPr || undefined === NumPr.NumId || 0 === NumPr.NumId || "0" === NumPr.NumId )
                        {
                            // Ничего не делаем
                        }
                        else
                        {
                            var Numbering = this.Parent.Get_Numbering();
                            var NumLvl    = Numbering.Get_AbstractNum( NumPr.NumId ).Lvl[NumPr.Lvl];
                            var NumJc     = NumLvl.Jc;
                            var NumTextPr = this.Get_CompiledPr2(false).TextPr.Copy();
                            NumTextPr.Merge( this.TextPr.Value );
                            NumTextPr.Merge( NumLvl.TextPr );

                            var X_start = X;

                            if ( align_Right === NumJc )
                                X_start = X - NumberingItem.WidthNum;
                            else if ( align_Center === NumJc )
                                X_start = X - NumberingItem.WidthNum / 2;

                            // Если есть выделение текста, рисуем его сначала
                            if ( highlight_None != NumTextPr.HighLight )
                                PDSH.High.Add( Y0, Y1, X_start, X_start + NumberingItem.WidthNum + NumberingItem.WidthSuff, 0, NumTextPr.HighLight.r, NumTextPr.HighLight.g, NumTextPr.HighLight.b );
                        }
                    }

                    PDSH.X += this.Numbering.WidthVisible;
                }

                for ( var Pos = StartPos; Pos <= EndPos; Pos++ )
                {
                    var Item = this.Content[Pos];
                    Item.Draw_HighLights( PDSH );
                }

                //----------------------------------------------------------------------------------------------------------
                // Заливка параграфа
                //----------------------------------------------------------------------------------------------------------
                if ( (_Range.W > 0.001 || true === this.IsEmpty() || true !== this.Is_EmptyRange(CurLine, CurRange) ) && ( ( this.Pages.length - 1 === CurPage ) || ( CurLine < this.Pages[CurPage + 1].FirstLine ) ) && shd_Clear === Pr.ParaPr.Shd.Value && (Pr.ParaPr.Shd.Unifill || (Pr.ParaPr.Shd.Color && true !== Pr.ParaPr.Shd.Color.Auto)) )
                {
                    var TempX0 = this.Lines[CurLine].Ranges[CurRange].X;
                    if ( 0 === CurRange )
                        TempX0 = Math.min( TempX0, this.Pages[CurPage].X + Pr.ParaPr.Ind.Left, this.Pages[CurPage].X + Pr.ParaPr.Ind.Left + Pr.ParaPr.Ind.FirstLine );

                    var TempX1 = this.Lines[CurLine].Ranges[CurRange].XEnd;

                    var TempTop    = this.Lines[CurLine].Top;
                    var TempBottom = this.Lines[CurLine].Bottom;

                    if ( 0 === CurLine )
                    {
                        // Закрашиваем фон до параграфа, только если данный параграф не является первым
                        // на странице, предыдущий параграф тоже имеет не пустой фон и у текущего и предыдущего
                        // параграфов совпадают правая и левая границы фонов.

                        var PrevEl = this.Get_DocumentPrev();
                        var PrevPr = null;

                        var PrevLeft  = 0;
                        var PrevRight = 0;
                        var CurLeft  = Math.min( Pr.ParaPr.Ind.Left, Pr.ParaPr.Ind.Left + Pr.ParaPr.Ind.FirstLine );
                        var CurRight = Pr.ParaPr.Ind.Right;
                        if ( null != PrevEl && type_Paragraph === PrevEl.GetType() )
                        {
                            PrevPr    = PrevEl.Get_CompiledPr2();
                            PrevLeft  = Math.min( PrevPr.ParaPr.Ind.Left, PrevPr.ParaPr.Ind.Left + PrevPr.ParaPr.Ind.FirstLine );
                            PrevRight = PrevPr.ParaPr.Ind.Right;
                        }

                        // Если данный параграф находится в группе параграфов с одинаковыми границами(с хотябы одной
                        // непустой), и он не первый, тогда закрашиваем вместе с расстоянием до параграфа
                        if ( true === Pr.ParaPr.Brd.First )
                        {
                            // Если следующий элемент таблица, тогда PrevPr = null
                            if ( null === PrevEl || true === this.Is_StartFromNewPage() || null === PrevPr || shd_Nil === PrevPr.ParaPr.Shd.Value || PrevLeft != CurLeft || CurRight != PrevRight || false === this.Internal_Is_NullBorders(PrevPr.ParaPr.Brd) || false === this.Internal_Is_NullBorders(Pr.ParaPr.Brd) )
                            {
                                if ( false === this.Is_StartFromNewPage() || null === PrevEl )
                                    TempTop += Pr.ParaPr.Spacing.Before;
                            }
                        }
                    }

                    if ( this.Lines.length - 1 === CurLine )
                    {
                        // Закрашиваем фон после параграфа, только если данный параграф не является последним,
                        // на странице, следующий параграф тоже имеет не пустой фон и у текущего и следующего
                        // параграфов совпадают правая и левая границы фонов.

                        var NextEl = this.Get_DocumentNext();
                        var NextPr = null;

                        var NextLeft  = 0;
                        var NextRight = 0;
                        var CurLeft  = Math.min( Pr.ParaPr.Ind.Left, Pr.ParaPr.Ind.Left + Pr.ParaPr.Ind.FirstLine );
                        var CurRight = Pr.ParaPr.Ind.Right;
                        if ( null != NextEl && type_Paragraph === NextEl.GetType() )
                        {
                            NextPr    = NextEl.Get_CompiledPr2();
                            NextLeft  = Math.min( NextPr.ParaPr.Ind.Left, NextPr.ParaPr.Ind.Left + NextPr.ParaPr.Ind.FirstLine );
                            NextRight = NextPr.ParaPr.Ind.Right;
                        }

                        if ( null != NextEl && type_Paragraph === NextEl.GetType() && true === NextEl.Is_StartFromNewPage() )
                        {
                            TempBottom = this.Lines[CurLine].Y + this.Lines[CurLine].Metrics.Descent + this.Lines[CurLine].Metrics.LineGap;
                        }
                        // Если данный параграф находится в группе параграфов с одинаковыми границами(с хотябы одной
                        // непустой), и он не последний, тогда закрашиваем вместе с расстоянием после параграфа
                        else if ( true === Pr.ParaPr.Brd.Last )
                        {
                            // Если следующий элемент таблица, тогда NextPr = null
                            if ( null === NextEl || true === NextEl.Is_StartFromNewPage() || null === NextPr || shd_Nil === NextPr.ParaPr.Shd.Value || NextLeft != CurLeft || CurRight != NextRight || false === this.Internal_Is_NullBorders(NextPr.ParaPr.Brd) || false === this.Internal_Is_NullBorders(Pr.ParaPr.Brd) )
                                TempBottom -= Pr.ParaPr.Spacing.After;
                        }
                    }

                    if ( 0 === CurRange )
                    {
                        if ( Pr.ParaPr.Brd.Left.Value === border_Single )
                            TempX0 -= 1 + Pr.ParaPr.Brd.Left.Size + Pr.ParaPr.Brd.Left.Space;
                        else
                            TempX0 -= 1;
                    }

                    if ( this.Lines[CurLine].Ranges.length - 1 === CurRange )
                    {
                        if ( Pr.ParaPr.Brd.Right.Value === border_Single )
                            TempX1 += 1 + Pr.ParaPr.Brd.Right.Size + Pr.ParaPr.Brd.Right.Space;
                        else
                            TempX1 += 1;
                    }

                    if(Pr.ParaPr.Shd.Unifill)
                    {
                        Pr.ParaPr.Shd.Unifill.check(this.Get_Theme(), this.Get_ColorMap());
                        var RGBA = Pr.ParaPr.Shd.Unifill.getRGBAColor();
                        pGraphics.b_color1( RGBA.R, RGBA.G, RGBA.B, 255 );
                    }
                    else
                    {
                        pGraphics.b_color1( Pr.ParaPr.Shd.Color.r, Pr.ParaPr.Shd.Color.g, Pr.ParaPr.Shd.Color.b, 255 );
                    }
                    pGraphics.rect(TempX0, this.Pages[CurPage].Y + TempTop, TempX1 - TempX0, TempBottom - TempTop);
                    pGraphics.df();
                }

                //----------------------------------------------------------------------------------------------------------
                // Рисуем заливку текста
                //----------------------------------------------------------------------------------------------------------
                var aShd = PDSH.Shd;
                var Element = aShd.Get_Next();
                while ( null != Element )
                {
                    pGraphics.b_color1( Element.r, Element.g, Element.b, 255 );
                    pGraphics.rect( Element.x0, Element.y0, Element.x1 - Element.x0, Element.y1 - Element.y0 );
                    pGraphics.df();
                    Element = aShd.Get_Next();
                }

                //----------------------------------------------------------------------------------------------------------
                // Рисуем выделение текста
                //----------------------------------------------------------------------------------------------------------
                var aHigh = PDSH.High;
                var Element = aHigh.Get_Next();
                while ( null != Element )
                {
                    pGraphics.b_color1( Element.r, Element.g, Element.b, 255 );
                    pGraphics.rect( Element.x0, Element.y0, Element.x1 - Element.x0, Element.y1 - Element.y0 );
                    pGraphics.df();
                    Element = aHigh.Get_Next();
                }

                //----------------------------------------------------------------------------------------------------------
                // Рисуем комментарии
                //----------------------------------------------------------------------------------------------------------
                var aComm = PDSH.Comm;
                Element = ( pGraphics.RENDERER_PDF_FLAG === true ? null : aComm.Get_Next() );
                while ( null != Element )
                {
                    if ( Element.Additional.Active === true )
                        pGraphics.b_color1( 240, 200, 120, 255 );
                    else
                        pGraphics.b_color1( 248, 231, 195, 255 );

                    pGraphics.rect( Element.x0, Element.y0, Element.x1 - Element.x0, Element.y1 - Element.y0 );
                    pGraphics.df();

                    var TextTransform = this.Get_ParentTextTransform();
                    if (TextTransform)
                    {
                        var _x0 = TextTransform.TransformPointX( Element.x0, Element.y0 );
                        var _y0 = TextTransform.TransformPointY( Element.x0, Element.y0 );
                        var _x1 = TextTransform.TransformPointX( Element.x1, Element.y1 );
                        var _y1 = TextTransform.TransformPointY( Element.x1, Element.y1 );
                        DocumentComments.Add_DrawingRect(_x0, _y0, _x1 - _x0, _y1 - _y0, Page_abs, Element.Additional.CommentId);
                    }
                    else
                        DocumentComments.Add_DrawingRect(Element.x0, Element.y0, Element.x1 - Element.x0, Element.y1 - Element.y0, Page_abs, Element.Additional.CommentId);

                    Element = aComm.Get_Next();
                }

                //----------------------------------------------------------------------------------------------------------
                // Рисуем выделение совместного редактирования
                //----------------------------------------------------------------------------------------------------------
                var aColl = PDSH.Coll;
                Element = aColl.Get_Next();
                while ( null != Element )
                {
                    pGraphics.drawCollaborativeChanges( Element.x0, Element.y0, Element.x1 - Element.x0, Element.y1 - Element.y0, Element );
                    Element = aColl.Get_Next();
                }

                //----------------------------------------------------------------------------------------------------------
                // Рисуем выделение поиска
                //----------------------------------------------------------------------------------------------------------
                var aFind = PDSH.Find;
                Element = aFind.Get_Next();
                while ( null != Element )
                {
                    pGraphics.drawSearchResult( Element.x0, Element.y0, Element.x1 - Element.x0, Element.y1 - Element.y0 );
                    Element = aFind.Get_Next();
                }
            }

            //----------------------------------------------------------------------------------------------------------
            // Рисуем боковые линии границы параграфа
            //----------------------------------------------------------------------------------------------------------
            if ( true === bDrawBorders && ( ( this.Pages.length - 1 === CurPage ) || ( CurLine < this.Pages[CurPage + 1].FirstLine ) ) )
            {
                var TempX0 = Math.min( this.Lines[CurLine].Ranges[0].X, this.Pages[CurPage].X + Pr.ParaPr.Ind.Left, this.Pages[CurPage].X + Pr.ParaPr.Ind.Left + Pr.ParaPr.Ind.FirstLine);
                var TempX1 = this.Lines[CurLine].Ranges[this.Lines[CurLine].Ranges.length - 1].XEnd;

                if ( true === this.Is_LineDropCap() )
                {
                    TempX1 = TempX0 + this.Get_LineDropCapWidth();
                }

                var TempTop    = this.Lines[CurLine].Top;
                var TempBottom = this.Lines[CurLine].Bottom;

                if ( 0 === CurLine )
                {
                    if ( Pr.ParaPr.Brd.Top.Value === border_Single || shd_Clear === Pr.ParaPr.Shd.Value )
                    {
                        if ( ( true === Pr.ParaPr.Brd.First && ( 0 === CurPage || true === this.Parent.Is_TableCellContent() || true === Pr.ParaPr.PageBreakBefore ) ) ||
                             ( true !== Pr.ParaPr.Brd.First && ( ( 0 === CurPage && null === this.Get_DocumentPrev() ) || ( 1 === CurPage && true === this.Is_StartFromNewPage() )  ) ) )
                            TempTop += Pr.ParaPr.Spacing.Before;
                    }
                }

                if ( this.Lines.length - 1 === CurLine )
                {
                    var NextEl = this.Get_DocumentNext();
                    if ( null != NextEl && type_Paragraph === NextEl.GetType() && true === NextEl.Is_StartFromNewPage() )
                        TempBottom = this.Lines[CurLine].Y + this.Lines[CurLine].Metrics.Descent + this.Lines[CurLine].Metrics.LineGap;
                    else if ( true === Pr.ParaPr.Brd.Last &&  ( Pr.ParaPr.Brd.Bottom.Value === border_Single || shd_Clear === Pr.ParaPr.Shd.Value ) )
                        TempBottom -= Pr.ParaPr.Spacing.After;
                }


                if ( Pr.ParaPr.Brd.Right.Value === border_Single )
                {
                    var RGBA = Pr.ParaPr.Brd.Right.Get_Color(this);
                    pGraphics.p_color(RGBA.r, RGBA.g, RGBA.b, 255 );
                    pGraphics.drawVerLine( c_oAscLineDrawingRule.Right, TempX1 + 1 + Pr.ParaPr.Brd.Right.Size + Pr.ParaPr.Brd.Right.Space, this.Pages[CurPage].Y + TempTop, this.Pages[CurPage].Y + TempBottom, Pr.ParaPr.Brd.Right.Size );
                }

                if ( Pr.ParaPr.Brd.Left.Value === border_Single )
                {
                    var RGBA = Pr.ParaPr.Brd.Left.Get_Color(this);
                    pGraphics.p_color(RGBA.r, RGBA.g, RGBA.b, 255 );
                    pGraphics.drawVerLine( c_oAscLineDrawingRule.Left, TempX0 - 1 - Pr.ParaPr.Brd.Left.Size - Pr.ParaPr.Brd.Left.Space, this.Pages[CurPage].Y + TempTop, this.Pages[CurPage].Y + TempBottom, Pr.ParaPr.Brd.Left.Size );
                }
            }

        }
    },

    Internal_Draw_4 : function(CurPage, pGraphics, Pr, BgColor, Theme, ColorMap)
    {
        var PDSE = this.m_oPDSE;
        PDSE.Reset( this, pGraphics, BgColor, Theme, ColorMap);

        var StartLine = this.Pages[CurPage].StartLine;
        var EndLine   = this.Pages[CurPage].EndLine;

        for ( var CurLine = StartLine; CurLine <= EndLine; CurLine++ )
        {
            var Line = this.Lines[CurLine];
            var RangesCount = Line.Ranges.length;

            for ( var CurRange = 0; CurRange < RangesCount; CurRange++ )
            {
                var Y = this.Pages[CurPage].Y + this.Lines[CurLine].Y;
                var X = this.Lines[CurLine].Ranges[CurRange].XVisible;

                var Range = Line.Ranges[CurRange];

                PDSE.Reset_Range( CurPage, CurLine, CurRange, X, Y );

                var StartPos = Range.StartPos;
                var EndPos   = Range.EndPos;

                // Отрисовка нумерации
                if ( true === this.Numbering.Check_Range(CurRange, CurLine) )
                {
                    var NumberingItem = this.Numbering;
                    if ( para_Numbering === NumberingItem.Type )
                    {
                        var NumPr = Pr.ParaPr.NumPr;
                        if ( undefined === NumPr || undefined === NumPr.NumId || 0 === NumPr.NumId || "0" === NumPr.NumId || ( undefined !== this.Get_SectionPr() && true === this.IsEmpty() ) )
                        {
                            // Ничего не делаем
                        }
                        else
                        {
                            var Numbering = this.Parent.Get_Numbering();
                            var NumLvl    = Numbering.Get_AbstractNum( NumPr.NumId ).Lvl[NumPr.Lvl];
                            var NumSuff   = NumLvl.Suff;
                            var NumJc     = NumLvl.Jc;
                            var NumTextPr = this.Get_CompiledPr2(false).TextPr.Copy();

                            // Word не рисует подчеркивание у символа списка, если оно пришло из настроек для
                            // символа параграфа.

                            var TextPr_temp = this.TextPr.Value.Copy();
                            TextPr_temp.Underline = undefined;

                            NumTextPr.Merge( TextPr_temp );
                            NumTextPr.Merge( NumLvl.TextPr );

                            var X_start = X;

                            if ( align_Right === NumJc )
                                X_start = X - NumberingItem.WidthNum;
                            else if ( align_Center === NumJc )
                                X_start = X - NumberingItem.WidthNum / 2;

                            var AutoColor = ( undefined != BgColor && false === BgColor.Check_BlackAutoColor() ? new CDocumentColor( 255, 255, 255, false ) : new CDocumentColor( 0, 0, 0, false ) );


                            var RGBA ;
                            if(NumTextPr.Unifill)
                            {
                                NumTextPr.Unifill.check(PDSE.Theme, PDSE.ColorMap);
                                RGBA = NumTextPr.Unifill.getRGBAColor();
                                pGraphics.b_color1(RGBA.R, RGBA.G, RGBA.B, 255 );
                            }
                            else
                            {
                                if ( true === NumTextPr.Color.Auto )
                                    pGraphics.b_color1( AutoColor.r, AutoColor.g, AutoColor.b, 255);
                                else
                                    pGraphics.b_color1(NumTextPr.Color.r, NumTextPr.Color.g, NumTextPr.Color.b, 255 );
                            }

                            // Рисуется только сам символ нумерации
                            switch ( NumJc )
                            {
                                case align_Right:
                                    NumberingItem.Draw( X - NumberingItem.WidthNum, Y, pGraphics, Numbering, NumTextPr, NumPr, PDSE.Theme );
                                    break;

                                case align_Center:
                                    NumberingItem.Draw( X - NumberingItem.WidthNum / 2, Y, pGraphics, Numbering, NumTextPr, NumPr, PDSE.Theme );
                                    break;

                                case align_Left:
                                default:
                                    NumberingItem.Draw( X, Y, pGraphics, Numbering, NumTextPr, NumPr, PDSE.Theme );
                                    break;
                            }

                            if ( true === editor.ShowParaMarks && numbering_suff_Tab === NumSuff )
                            {
                                var TempWidth     = NumberingItem.WidthSuff;
                                var TempRealWidth = 3.143; // ширина символа "стрелка влево" в шрифте Wingding3,10

                                var X1 = X;
                                switch ( NumJc )
                                {
                                    case align_Right:
                                        break;

                                    case align_Center:
                                        X1 += NumberingItem.WidthNum / 2;
                                        break;

                                    case align_Left:
                                    default:
                                        X1 += NumberingItem.WidthNum;
                                        break;
                                }

                                var X0 = TempWidth / 2 - TempRealWidth / 2;

                                pGraphics.SetFont( {FontFamily: { Name : "ASCW3", Index : -1 }, FontSize: 10, Italic: false, Bold : false} );

                                if ( X0 > 0 )
                                    pGraphics.FillText2( X1 + X0, Y, String.fromCharCode( tab_Symbol ), 0, TempWidth );
                                else
                                    pGraphics.FillText2( X1, Y, String.fromCharCode( tab_Symbol ), TempRealWidth - TempWidth, TempWidth );
                            }

                            if ( true === NumTextPr.Strikeout || true === NumTextPr.Underline )
                            {
                                if(NumTextPr.Unifill)
                                {
                                    pGraphics.p_color( RGBA.R, RGBA.G, RGBA.B, 255 );
                                }
                                else
                                {
                                    if ( true === NumTextPr.Color.Auto )
                                        pGraphics.p_color( AutoColor.r, AutoColor.g, AutoColor.b, 255);
                                    else
                                        pGraphics.p_color( NumTextPr.Color.r, NumTextPr.Color.g, NumTextPr.Color.b, 255 );
                                }
                            }

                            if ( true === NumTextPr.Strikeout )
                                pGraphics.drawHorLine(0, (Y - NumTextPr.FontSize * g_dKoef_pt_to_mm * 0.27), X_start, X_start + NumberingItem.WidthNum, (NumTextPr.FontSize / 18) * g_dKoef_pt_to_mm);

                            if ( true === NumTextPr.Underline )
                                pGraphics.drawHorLine( 0, (Y + this.Lines[CurLine].Metrics.TextDescent * 0.4), X_start, X_start + NumberingItem.WidthNum, (NumTextPr.FontSize / 18) * g_dKoef_pt_to_mm);
                        }
                    }
                    else if ( para_PresentationNumbering === this.Numbering.Type )
                    {
                        if ( true != this.IsEmpty() )
                        {
                            if ( Pr.ParaPr.Ind.FirstLine < 0 )
                                NumberingItem.Draw( X, Y, pGraphics, this.Get_FirstTextPr(), PDSE );
                            else
                                NumberingItem.Draw( this.X + Pr.ParaPr.Ind.Left, Y, pGraphics, this.Get_FirstTextPr(), PDSE );
                        }
                    }

                    PDSE.X += NumberingItem.WidthVisible;
                }

                for ( var Pos = StartPos; Pos <= EndPos; Pos++ )
                {
                    var Item = this.Content[Pos];
                    PDSE.CurPos.Update( Pos, 0 );

                    Item.Draw_Elements( PDSE );
                }
            }
        }
    },

    Internal_Draw_5 : function(CurPage, pGraphics, Pr, BgColor)
    {
        var PDSL = g_oPDSL;
        PDSL.Reset( this, pGraphics, BgColor );

        var Page = this.Pages[CurPage];

        var StartLine = Page.StartLine;
        var EndLine   = Page.EndLine;

        PDSL.SpellingCounter = this.SpellChecker.Get_DrawingInfo( this.Get_PageStartPos(CurPage) );

        for ( var CurLine = StartLine; CurLine <= EndLine; CurLine++ )
        {
            var Line      = this.Lines[CurLine];
            var LineM     = Line.Metrics;

            var Baseline        = Page.Y + Line.Y;
            var UnderlineOffset = LineM.TextDescent  * 0.4;

            PDSL.Reset_Line( CurPage, CurLine, Baseline, UnderlineOffset );

            // Сначала проанализируем данную строку: в массивы aStrikeout, aDStrikeout, aUnderline
            // aSpelling сохраним позиции начала и конца продолжительных одинаковых настроек зачеркивания,
            // двойного зачеркивания, подчеркивания и подчеркивания орфографии.

            var RangesCount = Line.Ranges.length;
            for ( var CurRange = 0; CurRange < RangesCount; CurRange++ )
            {
                var Range = Line.Ranges[CurRange];
                var X = Range.XVisible;

                PDSL.Reset_Range( CurRange, X, Range.SpacesSkip + Range.Spaces );

                var StartPos = Range.StartPos;
                var EndPos   = Range.EndPos;

                // TODO: Нумерация подчеркивается и зачеркивается в Draw_Elements, неплохо бы сюда перенести
                if ( true === this.Numbering.Check_Range( CurRange, CurLine ) )
                    PDSL.X += this.Numbering.WidthVisible;

                for ( var Pos = StartPos; Pos <= EndPos; Pos++ )
                {
                    PDSL.CurPos.Update( Pos, 0 );
                    var Item = this.Content[Pos];

                    Item.Draw_Lines(PDSL);
                }
            }

            var aStrikeout  = PDSL.Strikeout;
            var aDStrikeout = PDSL.DStrikeout;
            var aUnderline  = PDSL.Underline;
            var aSpelling   = PDSL.Spelling;

            // Рисуем зачеркивание
            var Element = aStrikeout.Get_Next();
            while ( null != Element )
            {
                pGraphics.p_color( Element.r, Element.g, Element.b, 255 );
                pGraphics.drawHorLine(c_oAscLineDrawingRule.Top, Element.y0, Element.x0, Element.x1, Element.w );
                Element = aStrikeout.Get_Next();
            }

            // Рисуем двойное зачеркивание
            Element = aDStrikeout.Get_Next();
            while ( null != Element )
            {
                pGraphics.p_color( Element.r, Element.g, Element.b, 255 );
                pGraphics.drawHorLine2(c_oAscLineDrawingRule.Top, Element.y0, Element.x0, Element.x1, Element.w );
                Element = aDStrikeout.Get_Next();
            }

            // Рисуем подчеркивание
            aUnderline.Correct_w_ForUnderline();
            Element = aUnderline.Get_Next();
            while ( null != Element )
            {
                pGraphics.p_color( Element.r, Element.g, Element.b, 255 );
                pGraphics.drawHorLine(0, Element.y0, Element.x0, Element.x1, Element.w );
                Element = aUnderline.Get_Next();
            }

            // Рисуем подчеркивание орфографии
            if(this.bFromDocument && this.LogicDocument && true === this.LogicDocument.Spelling.Use)
            {
                pGraphics.p_color( 255, 0, 0, 255 );
                var SpellingW = editor.WordControl.m_oDrawingDocument.GetMMPerDot(1);
                Element = aSpelling.Get_Next();
                while ( null != Element )
                {
                    pGraphics.DrawSpellingLine(Element.y0, Element.x0, Element.x1, SpellingW);
                    Element = aSpelling.Get_Next();
                }
            }
        }
    },

    Internal_Draw_6 : function(CurPage, pGraphics, Pr)
    {
        if ( true !== this.Is_NeedDrawBorders() )
            return;
        
        var bEmpty  = this.IsEmpty();
        var X_left  = Math.min( this.Pages[CurPage].X + Pr.ParaPr.Ind.Left, this.Pages[CurPage].X + Pr.ParaPr.Ind.Left + Pr.ParaPr.Ind.FirstLine );
        var X_right = this.Pages[CurPage].XLimit - Pr.ParaPr.Ind.Right;

        if ( true === this.Is_LineDropCap() )
            X_right = X_left + this.Get_LineDropCapWidth();

        if ( Pr.ParaPr.Brd.Left.Value === border_Single )
            X_left -= 1 + Pr.ParaPr.Brd.Left.Space;
        else
            X_left -= 1;

        if ( Pr.ParaPr.Brd.Right.Value === border_Single )
            X_right += 1 + Pr.ParaPr.Brd.Right.Space;
        else
            X_right += 1;

        var LeftMW  = -( border_Single === Pr.ParaPr.Brd.Left.Value  ? Pr.ParaPr.Brd.Left.Size  : 0 );
        var RightMW =  ( border_Single === Pr.ParaPr.Brd.Right.Value ? Pr.ParaPr.Brd.Right.Size : 0 );

        var RGBA;
        // Рисуем линию до параграфа
        if ( true === Pr.ParaPr.Brd.First && border_Single === Pr.ParaPr.Brd.Top.Value && ( ( 0 === CurPage && ( false === this.Is_StartFromNewPage() || null === this.Get_DocumentPrev() ) ) || ( 1 === CurPage && true === this.Is_StartFromNewPage() )  ) )
        {
            var Y_top = this.Pages[CurPage].Y;
            if ( 0 === CurPage || true === this.Parent.Is_TableCellContent() || true === Pr.ParaPr.PageBreakBefore )
                Y_top += Pr.ParaPr.Spacing.Before;

            RGBA = Pr.ParaPr.Brd.Top.Get_Color(this);
            pGraphics.p_color( RGBA.r, RGBA.g, RGBA.b, 255 );

            // Учтем разрывы из-за обтекания
            var StartLine = this.Pages[CurPage].StartLine;
            var RangesCount = this.Lines[StartLine].Ranges.length;
            for ( var CurRange = 0; CurRange < RangesCount; CurRange++ )
            {
                var X0 = ( 0 === CurRange ? X_left : this.Lines[StartLine].Ranges[CurRange].X );
                var X1 = ( RangesCount - 1 === CurRange ? X_right : this.Lines[StartLine].Ranges[CurRange].XEnd );

                if ( false === this.Is_EmptyRange(StartLine, CurRange) || ( true === bEmpty && 1 === RangesCount ) )
                    pGraphics.drawHorLineExt( c_oAscLineDrawingRule.Top, Y_top, X0, X1, Pr.ParaPr.Brd.Top.Size, LeftMW, RightMW );
            }
        }
        else if ( false === Pr.ParaPr.Brd.First )
        {
            var bDraw = false;
            var Size = 0;
            var Y    = 0;
            if ( 1 === CurPage && true === this.Is_StartFromNewPage() && border_Single === Pr.ParaPr.Brd.Top.Value )
            {
                RGBA = Pr.ParaPr.Brd.Top.Get_Color(this);
                pGraphics.p_color( RGBA.r, RGBA.g, RGBA.b, 255 );
                Size  = Pr.ParaPr.Brd.Top.Size;
                Y     = this.Pages[CurPage].Y + this.Lines[this.Pages[CurPage].FirstLine].Top + Pr.ParaPr.Spacing.Before;
                bDraw = true;
            }
            else if ( 0 === CurPage && false === this.Is_StartFromNewPage() && border_Single === Pr.ParaPr.Brd.Between.Value )
            {
                RGBA = Pr.ParaPr.Brd.Between.Get_Color(this);
                pGraphics.p_color( RGBA.r, RGBA.g, RGBA.b, 255 );
                Size  = Pr.ParaPr.Brd.Between.Size;
                Y     = this.Pages[CurPage].Y + Pr.ParaPr.Spacing.Before;
                bDraw = true;
            }

            if ( true === bDraw )
            {
                // Учтем разрывы из-за обтекания
                var StartLine = this.Pages[CurPage].StartLine;
                var RangesCount = this.Lines[StartLine].Ranges.length;
                for ( var CurRange = 0; CurRange < RangesCount; CurRange++ )
                {
                    var X0 = ( 0 === CurRange ? X_left : this.Lines[StartLine].Ranges[CurRange].X );
                    var X1 = ( RangesCount - 1 === CurRange ? X_right : this.Lines[StartLine].Ranges[CurRange].XEnd );

                    if ( false === this.Is_EmptyRange(StartLine, CurRange) || ( true === bEmpty && 1 === RangesCount ) )
                        pGraphics.drawHorLineExt( c_oAscLineDrawingRule.Top, Y, X0, X1, Size, LeftMW, RightMW );
                }
            }
        }

        var CurLine = this.Pages[CurPage].EndLine;
        var bEnd = ( this.Content.length - 2 <= this.Lines[CurLine].EndPos ? true : false );

        // Рисуем линию после параграфа
        if ( true === bEnd && true === Pr.ParaPr.Brd.Last && border_Single === Pr.ParaPr.Brd.Bottom.Value )
        {
            var TempY = this.Pages[CurPage].Y;
            var NextEl = this.Get_DocumentNext();
            var DrawLineRule = c_oAscLineDrawingRule.Bottom;
            if ( null != NextEl && type_Paragraph === NextEl.GetType() && true === NextEl.Is_StartFromNewPage() )
            {
                TempY = this.Pages[CurPage].Y + this.Lines[CurLine].Y + this.Lines[CurLine].Metrics.Descent + this.Lines[CurLine].Metrics.LineGap;
                DrawLineRule = c_oAscLineDrawingRule.Top;
            }
            else
            {
                TempY = this.Pages[CurPage].Y + this.Lines[CurLine].Bottom - Pr.ParaPr.Spacing.After;
                DrawLineRule = c_oAscLineDrawingRule.Bottom;
            }

            RGBA = Pr.ParaPr.Brd.Bottom.Get_Color(this);
            pGraphics.p_color( RGBA.r, RGBA.g, RGBA.b, 255 );

            // Учтем разрывы из-за обтекания
            var EndLine = this.Pages[CurPage].EndLine;
            var RangesCount = this.Lines[EndLine].Ranges.length;
            for ( var CurRange = 0; CurRange < RangesCount; CurRange++ )
            {
                var X0 = ( 0 === CurRange ? X_left : this.Lines[EndLine].Ranges[CurRange].X );
                var X1 = ( RangesCount - 1 === CurRange ? X_right : this.Lines[EndLine].Ranges[CurRange].XEnd );

                if ( false === this.Is_EmptyRange(EndLine, CurRange) || ( true === bEmpty && 1 === RangesCount ) )
                    pGraphics.drawHorLineExt( DrawLineRule, TempY, X0, X1, Pr.ParaPr.Brd.Bottom.Size, LeftMW, RightMW );
            }
        }
        else if ( true === bEnd && false === Pr.ParaPr.Brd.Last && border_Single === Pr.ParaPr.Brd.Bottom.Value )
        {
            var NextEl = this.Get_DocumentNext();
            if ( null != NextEl && type_Paragraph === NextEl.GetType() && true === NextEl.Is_StartFromNewPage() )
            {
                RGBA = Pr.ParaPr.Brd.Bottom.Get_Color(this);
                pGraphics.p_color( RGBA.r, RGBA.g, RGBA.b, 255 );

                // Учтем разрывы из-за обтекания
                var EndLine = this.Pages[CurPage].EndLine;
                var RangesCount = this.Lines[EndLine].Ranges.length;
                for ( var CurRange = 0; CurRange < RangesCount; CurRange++ )
                {
                    var X0 = ( 0 === CurRange ? X_left : this.Lines[EndLine].Ranges[CurRange].X );
                    var X1 = ( RangesCount - 1 === CurRange ? X_right : this.Lines[EndLine].Ranges[CurRange].XEnd );

                    if ( false === this.Is_EmptyRange(EndLine, CurRange) || ( true === bEmpty && 1 === RangesCount ) )
                        pGraphics.drawHorLineExt( c_oAscLineDrawingRule.Top, this.Pages[CurPage].Y + this.Lines[CurLine].Y + this.Lines[CurLine].Metrics.Descent + this.Lines[CurLine].Metrics.LineGap, X0, X1, Pr.ParaPr.Brd.Bottom.Size, LeftMW, RightMW );
                }
            }
        }

    },
    
    Is_NeedDrawBorders : function()
    {
        if ( true === this.IsEmpty() && undefined !== this.SectPr )
            return false;
        
        return true;
    },

    ReDraw : function()
    {
        this.Parent.OnContentReDraw( this.Get_StartPage_Absolute(), this.Get_StartPage_Absolute() + this.Pages.length - 1 );
    },

    Shift : function(PageIndex, Dx, Dy)
    {
        if ( 0 === PageIndex )
        {
            this.X      += Dx;
            this.Y      += Dy;
            this.XLimit += Dx;
            this.YLimit += Dy;
        }

        var Page_abs = PageIndex + this.Get_StartPage_Absolute();
        this.Pages[PageIndex].Shift( Dx, Dy );

        var StartLine = this.Pages[PageIndex].StartLine;
        var EndLine   = this.Pages[PageIndex].EndLine;
        
        for ( var CurLine = StartLine; CurLine <= EndLine; CurLine++ )
            this.Lines[CurLine].Shift( Dx, Dy );

        // Пробегаемся по всем картинкам на данной странице и обновляем координаты
        var Count = this.Content.length;
        for ( var CurLine = StartLine; CurLine <= EndLine; CurLine++ )
        {
            var Line = this.Lines[CurLine];
            var RangesCount = Line.Ranges.length;

            for ( var CurRange = 0; CurRange < RangesCount; CurRange++ )
            {
                var Range    = Line.Ranges[CurRange];
                var StartPos = Range.StartPos;
                var EndPos   = Range.EndPos;

                for ( var Pos = StartPos; Pos <= EndPos; Pos++ )
                {
                    var Item = this.Content[Pos];
                    Item.Shift_Range( Dx, Dy, CurLine, CurRange );
                }
            }
        }
    },


    // Удаляем элементы параграфа
    // nCount - количество удаляемых элементов, > 0 удаляем элементы после курсора
    //                                          < 0 удаляем элементы до курсора
    // bOnlyText - true: удаляем только текст и пробелы, false - Удаляем любые элементы
    Remove : function(nCount, bOnlyText, bRemoveOnlySelection, bOnAddText)
    {
        var Direction = nCount;
        var Result = true;

        if ( true === this.Selection.Use )
        {
            var StartPos = this.Selection.StartPos;
            var EndPos   = this.Selection.EndPos;

            if ( StartPos > EndPos )
            {
                var Temp = StartPos;
                StartPos = EndPos;
                EndPos   = Temp;
            }

            // Сразу проверим последний элемент на попадание ParaEnd в селект
            if ( EndPos === this.Content.length - 1 && true === this.Content[EndPos].Selection_CheckParaEnd() )
            {
                Result = false;

                // Если в данном параграфе было окончание секции, тогда удаляем его
                this.Set_SectionPr( undefined );
            }

            if ( StartPos === EndPos )
            {
                this.Content[StartPos].Remove(nCount, bOnAddText);

                // TODO: Как только избавимся от para_End переделать здесь
                // Последние 2 элемента не удаляем (один для para_End, второй для всего остального)
                if ( StartPos < this.Content.length - 2 && true === this.Content[StartPos].Is_Empty() )
                {
                    if ( this.Selection.StartPos === this.Selection.EndPos )
                        this.Selection.Use = false;

                    this.Internal_Content_Remove( StartPos );

                    this.CurPos.ContentPos = StartPos;
                    this.Content[StartPos].Cursor_MoveToStartPos();
                    this.Correct_ContentPos2();
                }
            }
            else
            {
                // Комментарии удаляем потом отдельно, чтобы не путались метки селекта
                var CommentsToDelete = {};
                for (var Pos = StartPos; Pos <= EndPos; Pos++)
                {
                    var Item = this.Content[Pos];
                    if (para_Comment === Item.Type)
                        CommentsToDelete[Item.CommentId] = true;
                }
                
                this.DeleteCommentOnRemove = false;
                
                this.Content[EndPos].Remove(nCount, bOnAddText);

                // TODO: Как только избавимся от para_End переделать здесь
                // Последние 2 элемента не удаляем (один для para_End, второй для всего остального)
                if ( EndPos < this.Content.length - 2 && true === this.Content[EndPos].Is_Empty() )
                {
                    this.Internal_Content_Remove( EndPos );

                    this.CurPos.ContentPos = EndPos;
                    this.Content[EndPos].Cursor_MoveToStartPos();
                    this.Correct_ContentPos2();
                }

                this.Internal_Content_Remove2( StartPos + 1, EndPos - StartPos - 1 );

                this.Content[StartPos].Remove(nCount, bOnAddText);

                // Мы не удаляем последний элемент с ParaEnd
                if ( StartPos < this.Content.length - 2  && true === this.Content[StartPos].Is_Empty() )
                {
                    if ( this.Selection.StartPos === this.Selection.EndPos )
                        this.Selection.Use = false;

                    this.Internal_Content_Remove( StartPos );                    
                }
                
                this.DeleteCommentOnRemove = true;

                for (var CommentId in CommentsToDelete)
                {
                    this.LogicDocument.Remove_Comment( CommentId, true, false );
                }
            }

            if ( true !== this.Content[this.CurPos.ContentPos].Selection_IsUse() )
            {
                this.Selection_Remove();
                this.Correct_Content(StartPos, EndPos);

            }
            else
            {
                this.Selection.Use      = true;
                this.Selection.Start    = false;
                this.Selection.Flag     = selectionflag_Common;
                this.Selection.StartPos = this.CurPos.ContentPos;
                this.Selection.EndPos   = this.CurPos.ContentPos;

                this.Correct_Content(StartPos, EndPos);

                this.Document_SetThisElementCurrent(false);

                return true;
            }
        }
        else
        {
            var ContentPos = this.CurPos.ContentPos;

            while ( false === this.Content[ContentPos].Remove( Direction, bOnAddText ) )
            {
                if ( Direction < 0 )
                    ContentPos--;
                else
                    ContentPos++;

                if ( ContentPos < 0 || ContentPos >= this.Content.length )
                    break;

                if ( Direction < 0 )
                    this.Content[ContentPos].Cursor_MoveToEndPos(false);
                else
                    this.Content[ContentPos].Cursor_MoveToStartPos();

            }

            if ( ContentPos < 0 || ContentPos >= this.Content.length )
                Result = false;
            else
            {
                if ( true === this.Content[ContentPos].Selection_IsUse() )
                {
                    this.Selection.Use      = true;
                    this.Selection.Start    = false;
                    this.Selection.Flag     = selectionflag_Common;
                    this.Selection.StartPos = ContentPos;
                    this.Selection.EndPos   = ContentPos;

                    this.Correct_Content(ContentPos, ContentPos);

                    this.Document_SetThisElementCurrent(false);

                    return true;
                }

                // TODO: Как только избавимся от para_End переделать здесь
                // Последние 2 элемента не удаляем (один для para_End, второй для всего остального)
                if ( ContentPos < this.Content.length - 2 && true === this.Content[ContentPos].Is_Empty() )
                {
                    this.Internal_Content_Remove( ContentPos );

                    this.CurPos.ContentPos = ContentPos;
                    this.Content[ContentPos].Cursor_MoveToStartPos();
                    this.Correct_ContentPos2();
                }
                else
                {
                    this.CurPos.ContentPos = ContentPos;
                }
            }

            this.Correct_Content(ContentPos, ContentPos);

            if ( Direction < 0 && false === Result )
            {
                // Мы стоим в начале параграфа и пытаемся удалить элемент влево. Действуем следующим образом:
                // 1. Если у нас параграф с нумерацией.
                //    1.1 Если нумерация нулевого уровня, тогда удаляем нумерацию, но при этом сохраняем
                //        значения отступов так как это делается в Word. (аналогично работаем с нумерацией в
                //        презентациях)
                //    1.2 Если нумерация не нулевого уровня, тогда уменьшаем уровень.
                // 2. Если у нас отступ первой строки ненулевой, тогда:
                //    2.1 Если он положительный делаем его нулевым.
                //    2.2 Если он отрицательный сдвигаем левый отступ на значение отступа первой строки,
                //        а сам отступ первой строки делаем нулевым.
                // 3. Если у нас ненулевой левый отступ, делаем его нулевым
                // 4. Если ничего из предыдущего не случается, тогда говорим родительскому классу, что удаление
                //    не было выполнено.

                Result = true;

                var Pr = this.Get_CompiledPr2(false).ParaPr;
                if ( undefined != this.Numbering_Get() )
                {
                    var NumPr = this.Numbering_Get();

                    if ( 0 === NumPr.Lvl )
                    {
                        this.Numbering_Remove();
                        this.Set_Ind( { FirstLine : 0, Left : Math.max( Pr.Ind.Left, Pr.Ind.Left + Pr.Ind.FirstLine ) }, false );
                    }
                    else
                    {
                        this.Numbering_IndDec_Level( false );
                    }
                }
                else if ( numbering_presentationnumfrmt_None != this.PresentationPr.Bullet.Get_Type() )
                {
                    this.Remove_PresentationNumbering();
                }
                else if ( align_Right === Pr.Jc )
                {
                    this.Set_Align( align_Center );
                }
                else if ( align_Center === Pr.Jc )
                {
                    this.Set_Align( align_Left );
                }
                else if ( Math.abs(Pr.Ind.FirstLine) > 0.001 )
                {
                    if ( Pr.Ind.FirstLine > 0 )
                        this.Set_Ind( { FirstLine : 0 }, false );
                    else
                        this.Set_Ind( { Left : Pr.Ind.Left + Pr.Ind.FirstLine, FirstLine : 0 }, false );
                }
                else if ( Math.abs(Pr.Ind.Left) > 0.001 )
                {
                    this.Set_Ind( { Left : 0 }, false );
                }
                else
                    Result = false;
            }
        }

        return Result;
    },

    Remove_ParaEnd : function()
    {
        var ContentLen = this.Content.length;
        for ( var CurPos = ContentLen - 1; CurPos >= 0; CurPos-- )
        {
            var Element = this.Content[CurPos];

            // Предполагаем, что para_End лежит только в ране, который лежит только на самом верхнем уровне
            if ( para_Run === Element.Type && true === Element.Remove_ParaEnd() )
                return;
        }
    },        

    // Ищем первый элемент, при промотке вперед
    Internal_FindForward : function(CurPos, arrId)
    {
        var LetterPos = CurPos;
        var bFound = false;
        var Type = para_Unknown;

        if ( CurPos < 0 || CurPos >= this.Content.length )
            return { Found : false };

        while ( !bFound )
        {
            Type = this.Content[LetterPos].Type;

            for ( var Id = 0; Id < arrId.length; Id++ )
            {
                if ( arrId[Id] == Type )
                {
                    bFound = true;
                    break;
                }
            }

            if ( bFound )
                break;

            LetterPos++;
            if ( LetterPos > this.Content.length - 1 )
                break;
        }

        return { LetterPos : LetterPos, Found : bFound, Type : Type };
    },

    // Ищем первый элемент, при промотке назад
    Internal_FindBackward : function(CurPos, arrId)
    {
        var LetterPos = CurPos;
        var bFound = false;
        var Type = para_Unknown;

        if ( CurPos < 0 || CurPos >= this.Content.length )
            return { Found : false };

        while ( !bFound )
        {
            Type = this.Content[LetterPos].Type;
            for ( var Id = 0; Id < arrId.length; Id++ )
            {
                if ( arrId[Id] == Type )
                {
                    bFound = true;
                    break;
                }
            }

            if ( bFound )
                break;

            LetterPos--;
            if ( LetterPos < 0 )
                break;
        }

        return { LetterPos : LetterPos, Found : bFound, Type : Type };
    },

    Get_TextPr : function(_ContentPos)
    {
        var ContentPos = ( undefined === _ContentPos ? this.Get_ParaContentPos( false, false ) : _ContentPos );

        var CurPos = ContentPos.Get(0);

        return this.Content[CurPos].Get_TextPr( ContentPos, 1 );
    },

    Internal_CalculateTextPr : function (LetterPos, StartPr)
    {
        var Pr;
        if ( "undefined" != typeof(StartPr) )
        {
            Pr = this.Get_CompiledPr();
            StartPr.ParaPr = Pr.ParaPr;
            StartPr.TextPr = Pr.TextPr;
        }
        else
        {
            Pr = this.Get_CompiledPr2(false);
        }

        // Выствляем начальные настройки текста у данного параграфа
        var TextPr = Pr.TextPr.Copy();

        // Ищем ближайший TextPr
        if ( LetterPos < 0 )
            return TextPr;

        // Ищем предыдущие записи с изменением текстовых свойств
        var Pos = this.Internal_FindBackward( LetterPos, [para_TextPr] );

        if ( true === Pos.Found )
        {
            var CurTextPr = this.Content[Pos.LetterPos].Value;

            // Копируем настройки из символьного стиля
            if ( undefined != CurTextPr.RStyle )
            {
                var Styles = this.Parent.Get_Styles();
                var StyleTextPr = Styles.Get_Pr( CurTextPr.RStyle, styletype_Character).TextPr;
                TextPr.Merge( StyleTextPr );
            }

            // Копируем прямые настройки
            TextPr.Merge( CurTextPr );
        }

        TextPr.FontFamily.Name  = TextPr.RFonts.Ascii.Name;
        TextPr.FontFamily.Index = TextPr.RFonts.Ascii.Index;

        return TextPr;
    },

    Internal_GetLang : function(LetterPos)
    {
        var Lang = this.Get_CompiledPr2(false).TextPr.Lang.Copy();

        // Ищем ближайший TextPr
        if ( LetterPos < 0 )
            return Lang;

        // Ищем предыдущие записи с изменением текстовых свойств
        var Pos = this.Internal_FindBackward( LetterPos, [para_TextPr] );

        if ( true === Pos.Found )
        {
            var CurTextPr = this.Content[Pos.LetterPos].Value;

            // Копируем настройки из символьного стиля
            if ( undefined != CurTextPr.RStyle )
            {
                var Styles = this.Parent.Get_Styles();
                var StyleTextPr = Styles.Get_Pr( CurTextPr.RStyle, styletype_Character).TextPr;
                Lang.Merge( StyleTextPr.Lang );
            }

            // Копируем прямые настройки
            Lang.Merge( CurTextPr.Lang );
        }

        return Lang;
    },

    Internal_GetTextPr : function(LetterPos)
    {
        var TextPr = new CTextPr();

        // Ищем ближайший TextPr
        if ( LetterPos < 0 )
            return TextPr;

        // Ищем предыдущие записи с изменением текстовых свойств
        var Pos = this.Internal_FindBackward( LetterPos, [para_TextPr] );

        if ( true === Pos.Found )
        {
            var CurTextPr = this.Content[Pos.LetterPos].Value;
            TextPr.Merge( CurTextPr );
        }
        // Если ничего не нашли, то TextPr будет пустым, что тоже нормально

        return TextPr;
    },

    // Добавляем новый элемент к содержимому параграфа (на текущую позицию)
    Add : function(Item)
    {
        // Выставляем родительский класс
        Item.Parent = this;

        switch (Item.Get_Type())
        {
            case para_Text:
            case para_Space:
            case para_PageNum:
            case para_Tab:
            case para_Drawing:
            case para_NewLine:
            {
                // Элементы данного типа добавляем во внутренний элемент
                this.Content[this.CurPos.ContentPos].Add( Item );

                break;
            }
            case para_TextPr:
            {
                var TextPr = Item.Value;

                if ( undefined != TextPr.FontFamily )
                {
                    var FName  = TextPr.FontFamily.Name;
                    var FIndex = TextPr.FontFamily.Index;

                    TextPr.RFonts = new CRFonts();
                    TextPr.RFonts.Ascii    = { Name : FName, Index : FIndex };
                    TextPr.RFonts.EastAsia = { Name : FName, Index : FIndex };
                    TextPr.RFonts.HAnsi    = { Name : FName, Index : FIndex };
                    TextPr.RFonts.CS       = { Name : FName, Index : FIndex };
                }

                if ( true === this.ApplyToAll )
                {
                    // Применяем настройки ко всем элементам параграфа
                    var ContentLen = this.Content.length;

                    for ( var CurPos = 0; CurPos < ContentLen; CurPos++ )
                    {
                        this.Content[CurPos].Apply_TextPr( TextPr, undefined, true );
                    }

                    // Выставляем настройки для символа параграфа
                    this.TextPr.Apply_TextPr( TextPr );
                }
                else
                {
                    if ( true === this.Selection.Use )
                    {
                        this.Apply_TextPr(TextPr);
                    }
                    else
                    {
                        var CurParaPos = this.Get_ParaContentPos( false, false );
                        var CurPos = CurParaPos.Get(0);

                        // Сначала посмотрим на элемент слева и справа(текущий)
                        var SearchLPos = new CParagraphSearchPos();
                        this.Get_LeftPos( SearchLPos, CurParaPos );

                        var RItem = this.Get_RunElementByPos( CurParaPos );
                        var LItem = ( false === SearchLPos.Found ? null : this.Get_RunElementByPos( SearchLPos.Pos ) );

                        // 1. Если мы находимся в конце параграфа, тогда применяем заданную настройку к знаку параграфа
                        //    и добавляем пустой ран с заданными настройками.
                        // 2. Если мы находимся в середине слова (справа и слева текстовый элемент, причем оба не пунктуация),
                        //    тогда меняем настройки для данного слова.
                        // 3. Во всех остальных случаях вставляем пустой ран с заданными настройкми и переносим курсор в этот
                        //    ран, чтобы при последующем наборе текст отрисовывался с нужными настройками.

                        if ( null === RItem || para_End === RItem.Type )
                        {
                            this.Apply_TextPr( TextPr );
                            this.TextPr.Apply_TextPr( TextPr );
                        }
                        else if ( null !== RItem && null !== LItem && para_Text === RItem.Type && para_Text === LItem.Type && false === RItem.Is_Punctuation() && false === LItem.Is_Punctuation() )
                        {
                            var SearchSPos = new CParagraphSearchPos();
                            var SearchEPos = new CParagraphSearchPos();

                            this.Get_WordStartPos( SearchSPos, CurParaPos );
                            this.Get_WordEndPos( SearchEPos, CurParaPos );

                            // Такого быть не должно, т.к. мы уже проверили, что справа и слева точно есть текст
                            if ( true !== SearchSPos.Found || true !== SearchEPos.Found )
                                return;

                            // Выставим временно селект от начала и до конца слова
                            this.Selection.Use = true;
                            this.Set_SelectionContentPos( SearchSPos.Pos, SearchEPos.Pos );

                            this.Apply_TextPr( TextPr );

                            // Убираем селект
                            this.Selection_Remove();
                        }
                        else
                        {
                            this.Apply_TextPr( TextPr );
                        }
                    }
                }

                break;
            }
            case para_Math:
            {
                var ContentPos = this.Get_ParaContentPos(false, false);
                var CurPos = ContentPos.Get(0);

                if ( para_Math !== this.Content[CurPos].Type )
                {
                    // Разделяем текущий элемент (возвращается правая часть)
                    var NewElement = this.Content[CurPos].Split( ContentPos, 1 );

                    if ( null !== NewElement )
                        this.Internal_Content_Add( CurPos + 1, NewElement );

					var Elem = new ParaMath();
					//Elem.Set_Paragraph(this);
					Elem.Root.Load_FromMenu(Item.Menu, this);
					Elem.Root.SetRunEmptyToContent(true);
                    // Добавляем гиперссылку в содержимое параграфа
                    this.Internal_Content_Add( CurPos + 1, Elem );

                    // TODO: ParaMath Сделать перемещение курсора в формулу

                    // Перемещаем кусор в конец гиперссылки
                    this.CurPos.ContentPos = CurPos;
                    this.Content[CurPos].Cursor_MoveToEndPos( false );
                }
                else
                    this.Content[CurPos].Add( Item );

                break;
            }
                
            case para_Run :
            {
                var ContentPos = this.Get_ParaContentPos(false, false);
                var CurPos = ContentPos.Get(0);
                
                var CurItem = this.Content[CurPos];
                
                switch ( CurItem.Type )
                {
                    case para_Run :
                    {
                        var NewRun = CurItem.Split(ContentPos, 1);
                        
                        this.Internal_Content_Add( CurPos + 1, Item );
                        this.Internal_Content_Add( CurPos + 2, NewRun );                        
                        this.CurPos.ContentPos = CurPos + 1;
                        break;
                    }
                        
                    case para_Math:
                    case para_Hyperlink:
                    {
                        CurItem.Add( Item );
                        break;
                    }
                        
                    default:
                    {
                        this.Internal_Content_Add( CurPos + 1, Item );
                        this.CurPos.ContentPos = CurPos + 1;
                        break;
                    }
                } 
                
                Item.Cursor_MoveToEndPos(false);
                                
                break;
            }
        }
    },

    // Данная функция вызывается, когда уже точно известно, что у нас либо выделение начинается с начала параграфа, либо мы стоим курсором в начале параграфа
    Add_Tab : function(bShift)
    {
        var NumPr = this.Numbering_Get();

        if ( undefined !== this.Numbering_Get() )
        {
            this.Shift_NumberingLvl( bShift );
        }
        else if ( true === this.Is_SelectionUse() )
        {
            this.IncDec_Indent( !bShift );
        }
        else
        {
            var ParaPr = this.Get_CompiledPr2(false).ParaPr;

            var LD_PageFields = this.LogicDocument.Get_PageFields( this.Get_StartPage_Absolute() );

            if ( true != bShift )
            {
                if ( ParaPr.Ind.FirstLine < 0 )
                {
                    this.Set_Ind( { FirstLine : 0 }, false );
                    this.CompiledPr.NeedRecalc = true;
                }
                else if ( ParaPr.Ind.FirstLine < 12.5 )
                {
                    this.Set_Ind( { FirstLine : 12.5 }, false );
                    this.CompiledPr.NeedRecalc = true;
                }
                else if ( LD_PageFields.XLimit - LD_PageFields.X > ParaPr.Ind.Left + 25 )
                {
                    this.Set_Ind( { Left : ParaPr.Ind.Left + 12.5 }, false );
                    this.CompiledPr.NeedRecalc = true;
                }
            }
            else
            {
                if ( ParaPr.Ind.FirstLine > 0 )
                {
                    if ( ParaPr.Ind.FirstLine > 12.5 )
                        this.Set_Ind( { FirstLine : ParaPr.Ind.FirstLine - 12.5 }, false );
                    else
                        this.Set_Ind( { FirstLine : 0 }, false );

                    this.CompiledPr.NeedRecalc = true;
                }
                else
                {
                    var Left = ParaPr.Ind.Left + ParaPr.Ind.FirstLine;
                    if ( Left < 0 )
                    {
                        this.Set_Ind( { Left : -ParaPr.Ind.FirstLine }, false );
                        this.CompiledPr.NeedRecalc = true;
                    }
                    else
                    {
                        if ( Left > 12.5 )
                            this.Set_Ind( { Left : ParaPr.Ind.Left - 12.5 }, false );
                        else
                            this.Set_Ind( { Left : -ParaPr.Ind.FirstLine }, false );

                        this.CompiledPr.NeedRecalc = true;
                    }
                }
            }
        }
    },

    // Расширяем параграф до позиции X
    Extend_ToPos : function(_X)
    {
        var CompiledPr  = this.Get_CompiledPr2(false).ParaPr;
        var Page = this.Pages[this.Pages.length - 1];

        var X0 = Page.X;                
        var X1 = Page.XLimit - X0;
        var X  = _X - X0;
        
        var Align = CompiledPr.Jc;
        
        if ( X < 0 || X > X1 || ( X < 7.5 && align_Left === Align ) || ( X > X1 - 10 && align_Right === Align ) || ( Math.abs( X1 / 2 - X ) < 10 && align_Center === Align )  )
            return false;
        
        if ( true === this.IsEmpty() )
        {
            if ( align_Left !== Align )
            {
                this.Set_Align( align_Left );
            }
            
            if ( Math.abs(X - X1 / 2) < 12.5 )            
            {
                this.Set_Align( align_Center );
                return true;
            }
            else if ( X > X1 - 12.5 )
            {
                this.Set_Align( align_Right );
                return true;
            }
            else if ( X < 17.5 )
            {
                this.Set_Ind( { FirstLine : 12.5 }, false );
                return true;
            }
        }

        var Tabs = CompiledPr.Tabs.Copy();

        if ( Math.abs(X - X1 / 2) < 12.5 )
            Tabs.Add( new CParaTab( tab_Center, X1 / 2 ) );
        else if ( X > X1 - 12.5 )
            Tabs.Add( new CParaTab( tab_Right, X1 - 0.001 ) );
        else
            Tabs.Add( new CParaTab( tab_Left, X ) );

        this.Set_Tabs( Tabs );

        this.Set_ParaContentPos( this.Get_EndPos( false ), false, -1, -1 );
        this.Add( new ParaTab() );     
        
        return true;
    },   

    IncDec_FontSize : function(bIncrease)
    {
        if ( true === this.ApplyToAll )
        {
            // Применяем настройки ко всем элементам параграфа
            var ContentLen = this.Content.length;

            for ( var CurPos = 0; CurPos < ContentLen; CurPos++ )
            {
                this.Content[CurPos].Apply_TextPr( undefined, bIncrease, true );
            }
        }
        else
        {
            if ( true === this.Selection.Use )
            {
                this.Apply_TextPr( undefined, bIncrease, false );
            }
            else
            {
                var CurParaPos = this.Get_ParaContentPos( false, false );
                var CurPos = CurParaPos.Get(0);

                // Сначала посмотрим на элемент слева и справа(текущий)
                var SearchLPos = new CParagraphSearchPos();
                this.Get_LeftPos( SearchLPos, CurParaPos );

                var RItem = this.Get_RunElementByPos( CurParaPos );
                var LItem = ( false === SearchLPos.Found ? null : this.Get_RunElementByPos( SearchLPos.Pos ) );

                // 1. Если мы находимся в конце параграфа, тогда применяем заданную настройку к знаку параграфа
                //    и добавляем пустой ран с заданными настройками.
                // 2. Если мы находимся в середине слова (справа и слева текстовый элемент, причем оба не пунктуация),
                //    тогда меняем настройки для данного слова.
                // 3. Во всех остальных случаях вставляем пустой ран с заданными настройкми и переносим курсор в этот
                //    ран, чтобы при последующем наборе текст отрисовывался с нужными настройками.

                if ( null === RItem || para_End === RItem.Type )
                {
                    // Изменение настройки для символа параграфа делается внутри
                    this.Apply_TextPr( undefined, bIncrease, false );
                }
                else if ( null !== RItem && null !== LItem && para_Text === RItem.Type && para_Text === LItem.Type && false === RItem.Is_Punctuation() && false === LItem.Is_Punctuation() )
                {
                    var SearchSPos = new CParagraphSearchPos();
                    var SearchEPos = new CParagraphSearchPos();

                    this.Get_WordStartPos( SearchSPos, CurParaPos );
                    this.Get_WordEndPos( SearchEPos, CurParaPos );

                    // Такого быть не должно, т.к. мы уже проверили, что справа и слева точно есть текст
                    if ( true !== SearchSPos.Found || true !== SearchEPos.Found )
                        return;

                    // Выставим временно селект от начала и до конца слова
                    this.Selection.Use = true;
                    this.Set_SelectionContentPos( SearchSPos.Pos, SearchEPos.Pos );

                    this.Apply_TextPr( undefined, bIncrease, false );

                    // Убираем селект
                    this.Selection_Remove();
                }
                else
                {
                    this.Apply_TextPr( undefined, bIncrease, false );
                }
            }
        }

        return true;
    },
    
    Shift_NumberingLvl : function(bShift)
    {
        var NumPr = this.Numbering_Get();
        
        if ( true != this.Selection.Use )
        {
            var NumId   = NumPr.NumId;
            var Lvl     = NumPr.Lvl;
            var NumInfo = this.Parent.Internal_GetNumInfo( this.Id, NumPr );

            if ( 0 === Lvl && NumInfo[Lvl] <= 1 )
            {
                var Numbering   = this.Parent.Get_Numbering();
                var AbstractNum = Numbering.Get_AbstractNum(NumId);

                var NumLvl = AbstractNum.Lvl[Lvl];
                var NumParaPr = NumLvl.ParaPr;

                var ParaPr = this.Get_CompiledPr2(false).ParaPr;

                if ( undefined != NumParaPr.Ind && undefined != NumParaPr.Ind.Left )
                {
                    var NewX = ParaPr.Ind.Left;
                    if ( true != bShift )
                        NewX += Default_Tab_Stop;
                    else
                    {
                        NewX -= Default_Tab_Stop;

                        if ( NewX < 0 )
                            NewX = 0;

                        if ( ParaPr.Ind.FirstLine < 0 && NewX + ParaPr.Ind.FirstLine < 0 )
                            NewX = -ParaPr.Ind.FirstLine;
                    }

                    AbstractNum.Change_LeftInd( NewX );

                    History.Add( this, { Type : historyitem_Paragraph_Ind_First, Old : ( undefined != this.Pr.Ind.FirstLine ? this.Pr.Ind.FirstLine : undefined ), New : undefined } );
                    History.Add( this, { Type : historyitem_Paragraph_Ind_Left,  Old : ( undefined != this.Pr.Ind.Left      ? this.Pr.Ind.Left      : undefined ), New : undefined } );

                    // При добавлении списка в параграф, удаляем все собственные сдвиги
                    this.Pr.Ind.FirstLine = undefined;
                    this.Pr.Ind.Left      = undefined;

                    // Надо пересчитать конечный стиль
                    this.CompiledPr.NeedRecalc = true;
                }
            }
            else
                this.Numbering_IndDec_Level( !bShift );
        }
        else
            this.Numbering_IndDec_Level( !bShift );
    },

    Can_IncreaseLevel : function(bIncrease)
    {
        var CurLevel = isRealNumber(this.Pr.Lvl) ? this.Pr.Lvl : 0, NewPr, OldPr = this.Get_CompiledPr2(false).TextPr, DeltaFontSize, i, j, RunPr;
        if(bIncrease)
        {
            if(CurLevel >= 8)
            {
                return false;
            }
            NewPr = this.Internal_CompiledParaPrPresentation(CurLevel + 1).TextPr;
        }
        else
        {
            if(CurLevel <= 0)
            {
                return false;
            }
            NewPr = this.Internal_CompiledParaPrPresentation(CurLevel - 1).TextPr;
        }
        DeltaFontSize = NewPr.FontSize - OldPr.FontSize;
        if(this.Pr.DefaultRunPr && isRealNumber(this.Pr.DefaultRunPr.FontSize))
        {
            if(this.Pr.DefaultRunPr.FontSize + DeltaFontSize < 1)
            {
                return false;
            }
        }
        if(isRealNumber(this.TextPr.FontSize))
        {
            if(this.TextPr.FontSize + DeltaFontSize < 1)
            {
                return false;
            }
        }
        for(i = 0; i < this.Content.length; ++i)
        {
            if(this.Content[i].Type === para_Run)
            {
                RunPr = this.Content[i].Get_CompiledPr();
                if(RunPr.FontSize + DeltaFontSize < 1)
                {
                    return false;
                }
            }
            else if(this.Content[i].Type === para_Hyperlink)
            {
                for(j = 0; j < this.Content[i].Content.length; ++j)
                {
                    RunPr = this.Content[i].Content[j].Get_CompiledPr();
                    if(RunPr.FontSize + DeltaFontSize < 1)
                    {
                        return false;
                    }
                }
            }
        }
        return true;
    },

    Increase_Level : function(bIncrease)
    {
        var CurLevel = isRealNumber(this.Pr.Lvl) ? this.Pr.Lvl : 0, NewPr, OldPr = this.Get_CompiledPr2(false).TextPr, DeltaFontSize, i, j, RunPr;
        if(bIncrease)
        {
            NewPr = this.Internal_CompiledParaPrPresentation(CurLevel + 1).TextPr;
            if (this.Pr.Ind && this.Pr.Ind.Left != undefined)
            {
                this.Set_Ind({ FirstLine: this.Pr.Ind.FirstLine, Left: this.Pr.Ind.Left + 11.1125 }, false);
            }
            this.Set_PresentationLevel(CurLevel + 1);
        }
        else
        {
            NewPr = this.Internal_CompiledParaPrPresentation(CurLevel - 1).TextPr;
            if (this.Pr.Ind && this.Pr.Ind.Left != undefined)
            {
                this.Set_Ind({ FirstLine: this.Pr.Ind.FirstLine, Left: this.Pr.Ind.Left - 11.1125 }, false);
            }
            this.Set_PresentationLevel(CurLevel - 1);
        }
        DeltaFontSize = NewPr.FontSize - OldPr.FontSize;
        if(DeltaFontSize !== 0)
        {
            if(this.Pr.DefaultRunPr && isRealNumber(this.Pr.DefaultRunPr.FontSize))
            {
                var NewParaPr = this.Pr.Copy();
                NewParaPr.DefaultRunPr.FontSize += DeltaFontSize;
                this.Set_Pr(NewParaPr);//Todo: сделать отдельный метод для выставления DefaultRunPr
            }
            if(isRealNumber(this.TextPr.FontSize))
            {
                this.TextPr.Set_FontSize(this.TextPr.FontSize + DeltaFontSize);
            }
            for(i = 0; i < this.Content.length; ++i)
            {
                if(this.Content[i].Type === para_Run)
                {
                    if(isRealNumber(this.Content[i].Pr.FontSize))
                    {
                        this.Content[i].Set_FontSize(this.Content[i].Pr.FontSize + DeltaFontSize);
                    }
                }
                else if(this.Content[i].Type === para_Hyperlink)
                {
                    for(j = 0; j < this.Content[i].Content.length; ++j)
                    {
                        if(isRealNumber(this.Content[i].Content[j].Pr.FontSize))
                        {
                            this.Content[i].Content[j].Set_FontSize(this.Content[i].Content[j].Pr.FontSize + DeltaFontSize);
                        }
                    }
                }
            }
        }
    },

    IncDec_Indent : function(bIncrease)
    {
        if ( undefined !== this.Numbering_Get() )
        {
            this.Shift_NumberingLvl( !bIncrease );
        }
        else
        {
            var ParaPr = this.Get_CompiledPr2(false).ParaPr;

            var LeftMargin = ParaPr.Ind.Left;
            if ( UnknownValue === LeftMargin )
                LeftMargin = 0;
            else if ( LeftMargin < 0 )
            {
                this.Set_Ind( { Left : 0 }, false );
                return;
            }

            var LeftMargin_new = 0;
            if ( true === bIncrease )
            {
                if ( LeftMargin >= 0 )
                {
                    LeftMargin = 12.5 * parseInt(10 * LeftMargin / 125);
                    LeftMargin_new = ( (LeftMargin - (10 * LeftMargin) % 125 / 10) / 12.5 + 1) * 12.5;
                }

                if ( LeftMargin_new < 0 )
                    LeftMargin_new = 12.5;
            }
            else
            {
                var TempValue = (125 - (10 * LeftMargin) % 125);
                TempValue = ( 125 === TempValue ? 0 : TempValue );
                LeftMargin_new = Math.max( ( (LeftMargin + TempValue / 10) / 12.5 - 1 ) * 12.5, 0 );
            }

            this.Set_Ind( { Left : LeftMargin_new }, false );
        }

        var NewPresLvl = ( true === bIncrease ? Math.min( 8, this.PresentationPr.Level + 1 ) : Math.max( 0, this.PresentationPr.Level - 1 ) );
        this.Set_PresentationLevel( NewPresLvl );
    },

    // Корректируем позицию курсора:
    // Если курсор находится в начале какого-либо рана, тогда мы его двигаем в конец предыдущего рана
    Correct_ContentPos : function(CorrectEndLinePos)
    {
        var Count  = this.Content.length;
        var CurPos = this.CurPos.ContentPos;

        // Если курсор попадает на конец строки, тогда мы его переносим в начало следующей
        if ( true === CorrectEndLinePos && true === this.Content[CurPos].Cursor_Is_End() )
        {
            var _CurPos = CurPos + 1;

            // Пропускаем пустые раны
            while ( _CurPos < Count && true === this.Content[_CurPos].Is_Empty( { SkipAnchor : true } ) )
                _CurPos++;

            if ( _CurPos < Count && true === this.Content[_CurPos].Is_StartFromNewLine() )
            {
                CurPos = _CurPos;
                this.Content[CurPos].Cursor_MoveToStartPos();
            }
        }

        while ( CurPos > 0 && true === this.Content[CurPos].Cursor_Is_NeededCorrectPos() )
        {
            CurPos--;
            this.Content[CurPos].Cursor_MoveToEndPos();
        }

        this.CurPos.ContentPos = CurPos;
    },

    Correct_ContentPos2 : function()
    {
        var Count  = this.Content.length;
        var CurPos = Math.min( Math.max( 0, this.CurPos.ContentPos ), Count - 1 );

        // Может так случиться, что текущий элемент окажется непригодным для расположения курсора, тогда мы ищем ближайший пригодный
        while ( CurPos > 0 && false === this.Content[CurPos].Is_CursorPlaceable() )
        {
            CurPos--;
            this.Content[CurPos].Cursor_MoveToEndPos();
        }

        while ( CurPos < Count && false === this.Content[CurPos].Is_CursorPlaceable() )
        {
            CurPos++;
            this.Content[CurPos].Cursor_MoveToStartPos(false);
        }

        // Если курсор находится в начале или конце гиперссылки, тогда выводим его из гиперссылки
        // TODO: Из каки
        while ( CurPos > 0 && para_Run !== this.Content[CurPos].Type && para_Math !== this.Content[CurPos].Type && true === this.Content[CurPos].Cursor_Is_Start() )
        {
            if ( false === this.Content[CurPos - 1].Is_CursorPlaceable() )
                break;

            CurPos--;
            this.Content[CurPos].Cursor_MoveToEndPos();
        }

        while ( CurPos < Count && para_Run !== this.Content[CurPos].Type && para_Math !== this.Content[CurPos].Type && true === this.Content[CurPos].Cursor_Is_End() )
        {
            if ( false === this.Content[CurPos + 1].Is_CursorPlaceable() )
                break;

            CurPos++;
            this.Content[CurPos].Cursor_MoveToStartPos(false);
        }

        this.CurPos.ContentPos = CurPos;
    },

    Get_ParaContentPos : function(bSelection, bStart)
    {
        var ContentPos = new CParagraphContentPos();

        var Pos = ( true !== bSelection ? this.CurPos.ContentPos : ( false !== bStart ? this.Selection.StartPos : this.Selection.EndPos ) );

        ContentPos.Add( Pos );

        this.Content[Pos].Get_ParaContentPos( bSelection, bStart, ContentPos );

        return ContentPos;
    },

    Set_ParaContentPos : function(ContentPos, CorrectEndLinePos, Line, Range)
    {
        var Pos = ContentPos.Get(0);

        if ( Pos >= this.Content.length )
            Pos = this.Content.length - 1;

        if ( Pos < 0 )
            Pos = 0;

        this.CurPos.ContentPos = Pos;
        this.Content[Pos].Set_ParaContentPos( ContentPos, 1 );
        this.Correct_ContentPos(CorrectEndLinePos);

        this.Correct_ContentPos2();

        this.CurPos.Line  = Line;
        this.CurPos.Range = Range;
    },

    Set_SelectionContentPos : function(StartContentPos, EndContentPos, CorrectAnchor)
    {
        var Depth = 0;

        var Direction = 1;
        if ( StartContentPos.Compare( EndContentPos ) > 0 )
            Direction = -1;

        var OldStartPos = Math.max(0, Math.min( this.Selection.StartPos, this.Content.length - 1 ));
        var OldEndPos   = Math.max(0, Math.min( this.Selection.EndPos, this.Content.length - 1 ));

        if ( OldStartPos > OldEndPos )
        {
            OldStartPos = this.Selection.EndPos;
            OldEndPos   = this.Selection.StartPos;
        }

        var StartPos = StartContentPos.Get( Depth );
        var EndPos   = EndContentPos.Get(Depth);

        this.Selection.StartPos = StartPos;
        this.Selection.EndPos   = EndPos;

        // Удалим отметки о старом селекте
        if ( OldStartPos < StartPos && OldStartPos < EndPos )
        {
            var TempLimit = Math.min( StartPos, EndPos );
            for ( var CurPos = OldStartPos; CurPos < TempLimit; CurPos++ )
            {
                this.Content[CurPos].Selection_Remove();
            }
        }

        if ( OldEndPos > StartPos && OldEndPos > EndPos )
        {
            var TempLimit = Math.max( StartPos, EndPos );
            for ( var CurPos = TempLimit + 1; CurPos <= OldEndPos; CurPos++ )
            {
                this.Content[CurPos].Selection_Remove();
            }
        }

        if ( StartPos === EndPos )
        {
            this.Content[StartPos].Set_SelectionContentPos( StartContentPos, EndContentPos, Depth + 1, 0, 0 );
        }
        else
        {
            if ( StartPos > EndPos )
            {
                this.Content[StartPos].Set_SelectionContentPos( StartContentPos, null, Depth + 1, 0, 1 );
                this.Content[EndPos].Set_SelectionContentPos( null, EndContentPos, Depth + 1, -1, 0 );

                for ( var CurPos = EndPos + 1; CurPos < StartPos; CurPos++ )
                    this.Content[CurPos].Select_All( -1 );
            }
            else// if ( StartPos < EndPos )
            {
                this.Content[StartPos].Set_SelectionContentPos( StartContentPos, null, Depth + 1, 0, -1 );
                this.Content[EndPos].Set_SelectionContentPos( null, EndContentPos, Depth + 1, 1, 0 );

                for ( var CurPos = StartPos + 1; CurPos < EndPos; CurPos++ )
                    this.Content[CurPos].Select_All( 1 );
            }            
            
            // TODO: Реализовать выделение гиперссылки целиком (само выделение тут сделано, но непонятно как
            //       дальше обрабатывать Shift + влево/вправо)

            // Делаем как в Word: гиперссылка выделяется целиком, если выделение выходит за пределы гиперссылки
//            if ( para_Hyperlink === this.Content[StartPos].Type && true !== this.Content[StartPos].Selection_IsEmpty(true) )
//                this.Content[StartPos].Select_All( StartPos > EndPos ? -1 : 1 );
//
//            if ( para_Hyperlink === this.Content[EndPos].Type && true !== this.Content[EndPos].Selection_IsEmpty(true) )
//                this.Content[EndPos].Select_All( StartPos > EndPos ? -1 : 1 );
        }
        
        if ( false !== CorrectAnchor )
        {
            // Дополнительная проверка. Если у нас визуально выделен весь параграф (т.е. весь текст и знак параграфа
            // обязательно!), тогда выделяем весь параграф целиком, чтобы в селект попадали и все привязанные объекты.
            // Но если у нас выделен параграф не целиком, тогда мы снимаем выделение с привязанных объектов, стоящих в
            // начале параграфа.

            if ( true === this.Selection_CheckParaEnd() )
            {
                // Эта ветка нужна для выделения плавающих объектов, стоящих в начале параграфа, когда параграф выделен весь

                var bNeedSelectAll = true;
                var StartPos = Math.min( this.Selection.StartPos, this.Selection.EndPos );
                for ( var Pos = 0; Pos <= StartPos; Pos++ )
                {
                    if ( false === this.Content[Pos].Is_SelectedAll( { SkipAnchor : true } ) )
                    {
                        bNeedSelectAll = false;
                        break;
                    }
                }

                if ( true === bNeedSelectAll )
                {
                    if ( 1 === Direction )
                        this.Selection.StartPos = 0;
                    else
                        this.Selection.EndPos   = 0;

                    for ( var Pos = 0; Pos <= StartPos; Pos++ )
                    {
                        this.Content[Pos].Select_All( Direction );
                    }
                }
            }
            else if ( true !== this.Selection_IsEmpty(true) && ( ( 1 === Direction && true === this.Selection.StartManually ) || ( 1 !== Direction && true === this.Selection.EndManually ) ) )
            {                                
                // Эта ветка нужна для снятие выделения с плавающих объектов, стоящих в начале параграфа, когда параграф
                // выделен не весь. Заметим, что это ветка имеет смысл, только при direction = 1, поэтому выделен весь
                // параграф или нет, проверяется попаданием para_End в селект. Кроме того, ничего не делаем с селектом,
                // если он пустой.
                
                var bNeedCorrectLeftPos = true;
                var _StartPos = Math.min( StartPos, EndPos );
                var _EndPos   = Math.max( StartPos, EndPos );
                for ( var Pos = 0; Pos < StartPos; Pos++ )
                {
                    if ( true !== this.Content[Pos].Is_Empty( { SkipAnchor : true } ) )
                    {
                        bNeedCorrectLeftPos = false;
                        break;
                    }
                }

                if ( true === bNeedCorrectLeftPos )
                {
                    for ( var Pos = _StartPos; Pos <= EndPos; Pos++ )
                    {
                        if ( true === this.Content[Pos].Selection_CorrectLeftPos(Direction) )
                        {
                            if ( 1 === Direction )
                            {
                                if ( Pos + 1 > this.Selection.EndPos )
                                    break;

                                this.Selection.StartPos = Pos + 1;
                            }
                            else
                            {
                                if ( Pos + 1 > this.Selection.StartPos )
                                    break;

                                this.Selection.EndPos   = Pos + 1;
                            }

                            this.Content[Pos].Selection_Remove();
                        }
                        else
                            break;
                    }
                }

            }
        }
    },

    Get_ParaContentPosByXY : function(X, Y, PageNum, bYLine, StepEnd)
    {
        var SearchPos = new CParagraphSearchPosXY();

        if ( this.Lines.length <= 0 )
            return SearchPos;

        // Определим страницу
        var PNum = ( PageNum === -1 || undefined === PageNum ? 0 : PageNum - this.PageNum );

        // Сначала определим на какую строку мы попали
        if ( PNum >= this.Pages.length )
        {
            PNum   = this.Pages.length - 1;
            bYLine = true;
            Y      = this.Lines.length - 1;
        }
        else if ( PNum < 0 )
        {
            PNum   = 0;
            bYLine = true;
            Y      = 0;
        }

        var CurLine = 0;
        if ( true === bYLine )
            CurLine = Y;
        else
        {
            CurLine  = this.Pages[PNum].FirstLine;

            var bFindY   = false;
            var CurLineY = this.Pages[PNum].Y + this.Lines[CurLine].Y + this.Lines[CurLine].Metrics.Descent + this.Lines[CurLine].Metrics.LineGap;
            var LastLine = ( PNum >= this.Pages.length - 1 ? this.Lines.length - 1 : this.Pages[PNum + 1].FirstLine - 1 );

            while ( !bFindY )
            {
                if ( Y < CurLineY )
                    break;
                if ( CurLine >= LastLine )
                    break;

                CurLine++;
                CurLineY = this.Lines[CurLine].Y + this.Pages[PNum].Y + this.Lines[CurLine].Metrics.Descent + this.Lines[CurLine].Metrics.LineGap;
            }
        }

        // Определим отрезок, в который мы попадаем
        var CurRange = 0;
        var RangesCount = this.Lines[CurLine].Ranges.length;

        if ( RangesCount > 1 )
        {
            for ( ; CurRange < RangesCount - 1; CurRange++ )
            {
                var _CurRange  = this.Lines[CurLine].Ranges[CurRange];
                var _NextRange = this.Lines[CurLine].Ranges[CurRange + 1];
                if ( X < (_CurRange.XEnd + _NextRange.X) / 2 )
                    break;
            }
        }

        if ( CurRange >= RangesCount )
            CurRange = Math.max(RangesCount - 1, 0);

        // Определим уже непосредственно позицию, куда мы попадаем
        var Range = this.Lines[CurLine].Ranges[CurRange];
        var StartPos = Range.StartPos;
        var EndPos   = Range.EndPos;

        SearchPos.CurX = Range.XVisible;
        SearchPos.X    = X;
        SearchPos.Y    = Y;

        // Проверим попадание в нумерацию
        if ( true === this.Numbering.Check_Range(CurRange, CurLine) )
        {
            var NumPr = this.Numbering_Get();
            if ( para_Numbering === this.Numbering.Type && undefined !== NumPr && undefined !== NumPr.NumId && 0 !== NumPr.NumId && "0" !== NumPr.NumId )
            {
                var NumJc = this.Parent.Get_Numbering().Get_AbstractNum( NumPr.NumId ).Lvl[NumPr.Lvl].Jc;

                var NumX0 = SearchPos.CurX;
                var NumX1 = SearchPos.CurX;

                switch( NumJc )
                {
                    case align_Right:
                    {
                        NumX0 -= this.Numbering.WidthNum;
                        break;
                    }
                    case align_Center:
                    {
                        NumX0 -= this.Numbering.WidthNum / 2;
                        NumX1 += this.Numbering.WidthNum / 2;
                        break;
                    }
                    case align_Left:
                    default:
                    {
                        NumX1 += this.Numbering.WidthNum;
                        break;
                    }
                }

                if ( SearchPos.X >= NumX0 && SearchPos.X <= NumX1 )
                {
                    SearchPos.Numbering = true;
                }
            }

            SearchPos.CurX += this.Numbering.WidthVisible;
        }

        for ( var CurPos = StartPos; CurPos <= EndPos; CurPos++ )
        {
            var Item = this.Content[CurPos];
            
            if ( false === SearchPos.InText )
                SearchPos.InTextPos.Update2( CurPos, 0 );

            if ( true === Item.Get_ParaContentPosByXY( SearchPos, 1, CurLine, CurRange, StepEnd ) )
                SearchPos.Pos.Update2( CurPos, 0 );
        }

        // По Х попали в какой-то элемент, проверяем по Y
        if ( true === SearchPos.InText && Y >= this.Pages[PNum].Y + this.Lines[CurLine].Y - this.Lines[CurLine].Metrics.Ascent - 0.01 && Y <= this.Pages[PNum].Y + this.Lines[CurLine].Y + this.Lines[CurLine].Metrics.Descent + this.Lines[CurLine].Metrics.LineGap + 0.01 )
            SearchPos.InText = true;
        else
            SearchPos.InText = false;

        // Такое возможно, если все раны до этого (в том числе и этот) были пустыми, тогда, чтобы не возвращать
        // неправильную позицию вернем позицию начала данного путого рана.
        if ( SearchPos.DiffX > 1000000 - 1 )
        {
            SearchPos.Line  = -1;
            SearchPos.Range = -1;
        }
        else
        {
            SearchPos.Line  = CurLine;
            SearchPos.Range = CurRange;
        }

        return SearchPos;
    },

    Cursor_GetPos : function()
    {
        return { X : this.CurPos.RealX, Y : this.CurPos.RealY };
    },

    Cursor_MoveLeft : function(Count, AddToSelect, Word)
    {
        if ( true === this.Selection.Use )
        {
            var EndSelectionPos   = this.Get_ParaContentPos( true, false );
            var StartSelectionPos = this.Get_ParaContentPos( true, true );

            if ( true !== AddToSelect )
            {
                // Найдем левую точку селекта
                var SelectPos = StartSelectionPos;
                if ( StartSelectionPos.Compare( EndSelectionPos ) > 0 )
                    SelectPos = EndSelectionPos;

                this.Selection_Remove();
                this.Set_ParaContentPos( SelectPos, true, -1, -1 );
            }
            else
            {
                var SearchPos = new CParagraphSearchPos();
                SearchPos.ForSelection = true;

                if ( true === Word )
                    this.Get_WordStartPos( SearchPos, EndSelectionPos );
                else
                    this.Get_LeftPos( SearchPos, EndSelectionPos );

                if ( true === SearchPos.Found )
                {
                    this.Set_SelectionContentPos( StartSelectionPos, SearchPos.Pos );
                }
                else
                {
                    return false;
                }
            }
        }
        else
        {
            var SearchPos  = new CParagraphSearchPos();
            var ContentPos = this.Get_ParaContentPos( false, false );
            
            if ( true === AddToSelect )
                SearchPos.ForSelection = true;

            if ( true === Word )
                this.Get_WordStartPos( SearchPos, ContentPos );
            else
                this.Get_LeftPos( SearchPos, ContentPos );

            if ( true === AddToSelect )
            {
                if ( true === SearchPos.Found )
                {
                    // Селекта еще нет, добавляем с текущей позиции
                    this.Selection.Use    = true;
                    this.Set_SelectionContentPos( ContentPos, SearchPos.Pos );
                }
                else
                {
                    this.Selection.Use = false;
                    return false;
                }
            }
            else
            {
                if ( true === SearchPos.Found )
                {
                    this.Set_ParaContentPos( SearchPos.Pos, true, -1, -1 );
                }
                else
                {
                    return false;
                }
            }
        }

        // Обновляем текущую позицию X,Y. Если есть селект, тогда обновляем по концу селекта
        if ( true === this.Selection.Use )
        {
            var SelectionEndPos = this.Get_ParaContentPos( true, false );
            this.Set_ParaContentPos( SelectionEndPos, false, -1, -1 );
        }

        this.Internal_Recalculate_CurPos( this.CurPos.ContentPos, true, false, false );

        this.CurPos.RealX = this.CurPos.X;
        this.CurPos.RealY = this.CurPos.Y;

        return true;
    },

    Cursor_MoveRight : function(Count, AddToSelect, Word)
    {
        if ( true === this.Selection.Use )
        {
            var EndSelectionPos   = this.Get_ParaContentPos( true, false );
            var StartSelectionPos = this.Get_ParaContentPos( true, true );

            if ( true !== AddToSelect )
            {
                // Проверим, попал ли конец параграфа в выделение
                if ( true === this.Selection_CheckParaEnd() )
                {
                    this.Selection_Remove();
                    this.Cursor_MoveToEndPos( false );
                    return false;
                }
                else
                {
                    // Найдем левую точку селекта
                    var SelectPos = EndSelectionPos;
                    if ( StartSelectionPos.Compare( EndSelectionPos ) > 0 )
                        SelectPos = StartSelectionPos;

                    this.Selection_Remove();

                    this.Set_ParaContentPos( SelectPos, true, -1, -1 );
                }
            }
            else
            {
                var SearchPos = new CParagraphSearchPos();
                SearchPos.ForSelection = true;

                if ( true === Word )
                    this.Get_WordEndPos( SearchPos, EndSelectionPos, true );
                else
                    this.Get_RightPos( SearchPos, EndSelectionPos, true );

                if ( true === SearchPos.Found )
                {
                    this.Set_SelectionContentPos( StartSelectionPos, SearchPos.Pos );
                }
                else
                {
                    return false;
                }
            }
        }
        else
        {
            var SearchPos  = new CParagraphSearchPos();
            var ContentPos = this.Get_ParaContentPos( false, false );

            if ( true === AddToSelect )
                SearchPos.ForSelection = true;

            if ( true === Word )
                this.Get_WordEndPos( SearchPos, ContentPos, AddToSelect );
            else
                this.Get_RightPos( SearchPos, ContentPos, AddToSelect );

            if ( true === AddToSelect )
            {
                if ( true === SearchPos.Found )
                {
                    // Селекта еще нет, добавляем с текущей позиции
                    this.Selection.Use    = true;
                    this.Set_SelectionContentPos( ContentPos, SearchPos.Pos );
                }
                else
                {
                    this.Selection.Use = false;
                    return false;
                }
            }
            else
            {
                if ( true === SearchPos.Found )
                {
                    this.Set_ParaContentPos( SearchPos.Pos, true, -1, -1 );
                }
                else
                {
                    return false;
                }
            }
        }

        // Обновляем текущую позицию X,Y. Если есть селект, тогда обновляем по концу селекта
        if ( true === this.Selection.Use )
        {
            var SelectionEndPos = this.Get_ParaContentPos( true, false );
            this.Set_ParaContentPos( SelectionEndPos, false, -1, -1 );
        }

        this.Internal_Recalculate_CurPos( this.CurPos.ContentPos, true, false, false );

        this.CurPos.RealX = this.CurPos.X;
        this.CurPos.RealY = this.CurPos.Y;

        return true;
    },

    Cursor_MoveAt : function(X,Y, bLine, bDontChangeRealPos, PageNum)
    {
        var SearchPosXY = this.Get_ParaContentPosByXY( X, Y, PageNum, bLine, false );

        this.Set_ParaContentPos( SearchPosXY.Pos, false, SearchPosXY.Line, SearchPosXY.Range );
        this.Internal_Recalculate_CurPos(-1, false, false, false );

        if ( bDontChangeRealPos != true )
        {
            this.CurPos.RealX = this.CurPos.X;
            this.CurPos.RealY = this.CurPos.Y;
        }

        if ( true != bLine )
        {
            this.CurPos.RealX = X;
            this.CurPos.RealY = Y;
        }
    },

    // Находим позицию заданного элемента. (Данной функцией лучше пользоваться, когда параграф рассчитан)
    Get_PosByElement : function(Class)
    {
        var ContentPos = new CParagraphContentPos();

        // Сначала попробуем определить местоположение по данным рассчета
        var CurRange = Class.StartRange;
        var CurLine  = Class.StartLine;

        var StartPos = this.Lines[CurLine].Ranges[CurRange].StartPos;
        var EndPos   = this.Lines[CurLine].Ranges[CurRange].EndPos;

        for ( var CurPos = StartPos; CurPos <= EndPos; CurPos++ )
        {
            var Element = this.Content[CurPos];

            ContentPos.Update( CurPos, 0 );

            if ( true === Element.Get_PosByElement(Class, ContentPos, 1, true, CurRange, CurLine) )
                return ContentPos;
        }

        // Если мы дошли до сюда, значит мы так и не нашли заданный класс. Попробуем его найти с помощью
        // поиска по всему параграфу, а не по заданному отрезку

        var ContentLen = this.Content.length;
        for ( var CurPos = 0; CurPos < ContentLen; CurPos++ )
        {
            var Element = this.Content[CurPos];

            ContentPos.Update( CurPos, 0 );

            if ( true === Element.Get_PosByElement(Class, ContentPos, 1, false, -1, -1) )
                return ContentPos;
        }
    },

    // Получаем по заданной позиции элемент текста
    Get_RunElementByPos : function(ContentPos)
    {
        var CurPos = ContentPos.Get(0);
        var ContentLen = this.Content.length;

        // Сначала ищем в текущем элементе
        var Element = this.Content[CurPos].Get_RunElementByPos( ContentPos, 1 );

        // Если заданная позиция была последней в текущем элементе, то ищем в следующем
        while ( null === Element )
        {
            CurPos++;

            if ( CurPos >= ContentLen )
                break;

            Element = this.Content[CurPos].Get_RunElementByPos();
        }

        return Element;
    },

    Get_PageStartPos : function(CurPage)
    {
        var CurLine  = this.Pages[CurPage].StartLine;
        var CurRange = 0;

        return this.Get_StartRangePos2( CurLine, CurRange );
    },

    Get_LeftPos : function(SearchPos, ContentPos)
    {
        var Depth  = 0;
        var CurPos = ContentPos.Get(Depth);

        this.Content[CurPos].Get_LeftPos(SearchPos, ContentPos, Depth + 1, true);
        SearchPos.Pos.Update( CurPos, Depth );

        if ( true === SearchPos.Found )
            return true;

        CurPos--;

        while ( CurPos >= 0 )
        {
            this.Content[CurPos].Get_LeftPos(SearchPos, ContentPos, Depth + 1, false);
            SearchPos.Pos.Update( CurPos, Depth );

            if ( true === SearchPos.Found )
                return true;

            CurPos--;
        }

        return false;
    },

    Get_RightPos : function(SearchPos, ContentPos, StepEnd)
    {
        var Depth  = 0;
        var CurPos = ContentPos.Get(Depth);

        this.Content[CurPos].Get_RightPos(SearchPos, ContentPos, Depth + 1, true, StepEnd);
        SearchPos.Pos.Update( CurPos, Depth );

        if ( true === SearchPos.Found )
            return true;

        CurPos++;

        var Count = this.Content.length;
        while ( CurPos < this.Content.length )
        {
            this.Content[CurPos].Get_RightPos(SearchPos, ContentPos, Depth + 1, false, StepEnd);
            SearchPos.Pos.Update( CurPos, Depth );

            if ( true === SearchPos.Found )
                return true;

            CurPos++;
        }

        return false;
    },

    Get_WordStartPos : function(SearchPos, ContentPos)
    {
        var Depth  = 0;
        var CurPos = ContentPos.Get(Depth);

        this.Content[CurPos].Get_WordStartPos(SearchPos, ContentPos, Depth + 1, true);

        if ( true === SearchPos.UpdatePos )
            SearchPos.Pos.Update( CurPos, Depth );

        if ( true === SearchPos.Found )
            return;

        CurPos--;

        var Count = this.Content.length;
        while ( CurPos >= 0 )
        {
            this.Content[CurPos].Get_WordStartPos(SearchPos, ContentPos, Depth + 1, false);

            if ( true === SearchPos.UpdatePos )
                SearchPos.Pos.Update( CurPos, Depth );

            if ( true === SearchPos.Found )
                return;

            CurPos--;
        }

        // Случай, когда слово шло с самого начала параграфа
        if ( true === SearchPos.Shift )
        {
            SearchPos.Found = true;
        }
    },

    Get_WordEndPos : function(SearchPos, ContentPos, StepEnd)
    {
        var Depth  = 0;
        var CurPos = ContentPos.Get(Depth);

        this.Content[CurPos].Get_WordEndPos(SearchPos, ContentPos, Depth + 1, true, StepEnd);

        if ( true === SearchPos.UpdatePos )
            SearchPos.Pos.Update( CurPos, Depth );

        if ( true === SearchPos.Found )
            return;

        CurPos++;

        var Count = this.Content.length;
        while ( CurPos < Count )
        {
            this.Content[CurPos].Get_WordEndPos(SearchPos, ContentPos, Depth + 1, false, StepEnd);

            if ( true === SearchPos.UpdatePos )
                SearchPos.Pos.Update( CurPos, Depth );

            if ( true === SearchPos.Found )
                return;

            CurPos++;
        }

        // Случай, когда слово шло с самого начала параграфа
        if ( true === SearchPos.Shift )
        {
            SearchPos.Found = true;
        }
    },

    Get_EndRangePos : function(SearchPos, ContentPos)
    {
        var LinePos = this.Get_ParaPosByContentPos(ContentPos);

        var CurLine  = LinePos.Line;
        var CurRange = LinePos.Range;

        var Range = this.Lines[CurLine].Ranges[CurRange];
        var StartPos = Range.StartPos;
        var EndPos   = Range.EndPos;

        SearchPos.Line  = CurLine;
        SearchPos.Range = CurRange;

        // Ищем в данном отрезке
        for ( var CurPos = StartPos; CurPos <= EndPos; CurPos++ )
        {
            var Item = this.Content[CurPos];

            if ( true === Item.Get_EndRangePos( CurLine, CurRange, SearchPos, 1 ) )
                SearchPos.Pos.Update( CurPos, 0 );
        }
    },

    Get_StartRangePos : function(SearchPos, ContentPos)
    {
        var LinePos = this.Get_ParaPosByContentPos(ContentPos);

        var CurLine  = LinePos.Line;
        var CurRange = LinePos.Range;

        var Range = this.Lines[CurLine].Ranges[CurRange];
        var StartPos = Range.StartPos;
        var EndPos   = Range.EndPos;

        SearchPos.Line  = CurLine;
        SearchPos.Range = CurRange;

        // Ищем в данном отрезке
        for ( var CurPos = EndPos; CurPos >= StartPos; CurPos-- )
        {
            var Item = this.Content[CurPos];

            if ( true === Item.Get_StartRangePos( CurLine, CurRange, SearchPos, 1 ) )
                SearchPos.Pos.Update( CurPos, 0 );
        }
    },

    Get_StartRangePos2 : function(CurLine, CurRange)
    {
        var ContentPos = new CParagraphContentPos();
        var Depth = 0;

        var Pos = this.Lines[CurLine].Ranges[CurRange].StartPos;
        ContentPos.Update( Pos, Depth );

        this.Content[Pos].Get_StartRangePos2( CurLine, CurRange, ContentPos, Depth + 1 );
        return ContentPos;
    },

    Get_StartPos : function()
    {
        var ContentPos = new CParagraphContentPos();
        var Depth = 0;

        ContentPos.Update( 0, Depth );

        this.Content[0].Get_StartPos( ContentPos, Depth + 1 );
        return ContentPos;
    },

    Get_EndPos : function(BehindEnd)
    {
        var ContentPos = new CParagraphContentPos();
        var Depth = 0;

        var ContentLen = this.Content.length;
        ContentPos.Update( ContentLen - 1, Depth );

        this.Content[ContentLen - 1].Get_EndPos( BehindEnd, ContentPos, Depth + 1 );
        return ContentPos;
    },

    Get_NextRunElements : function(RunElements)
    {
        var ContentPos = RunElements.ContentPos;
        var CurPos     = ContentPos.Get(0);
        var ContentLen = this.Content.length;

        this.Content[CurPos].Get_NextRunElements( RunElements, true,  1 );

        if ( RunElements.Count <= 0 )
            return;

        CurPos++;

        while ( CurPos < ContentLen )
        {
            this.Content[CurPos].Get_NextRunElements( RunElements, false,  1 );

            if ( RunElements.Count <= 0 )
                break;

            CurPos++;
        }
    },

    Get_PrevRunElements : function(RunElements)
    {
        var ContentPos = RunElements.ContentPos;
        var CurPos     = ContentPos.Get(0);

        this.Content[CurPos].Get_PrevRunElements( RunElements, true,  1 );

        if ( RunElements.Count <= 0 )
            return;

        CurPos--;

        while ( CurPos >= 0 )
        {
            this.Content[CurPos].Get_PrevRunElements( RunElements, false,  1 );

            if ( RunElements.Count <= 0 )
                break;

            CurPos--;
        }
    },

    Cursor_MoveUp : function(Count, AddToSelect)
    {
        var Result = true;
        if ( true === this.Selection.Use )
        {
            var SelectionStartPos = this.Get_ParaContentPos( true , true );
            var SelectionEndPos   = this.Get_ParaContentPos( true , false );

            if ( true === AddToSelect )
            {
                var LinePos = this.Get_ParaPosByContentPos( SelectionEndPos );
                var CurLine = LinePos.Line;

                if ( 0 == CurLine )
                {
                    EndPos = this.Get_StartPos();

                    // Переходим в предыдущий элемент документа
                    Result = false;
                }
                else
                {
                    this.Cursor_MoveAt( this.CurPos.RealX, CurLine - 1, true, true );
                    EndPos = this.Get_ParaContentPos(false, false);
                }

                this.Selection.Use = true;
                this.Set_SelectionContentPos( SelectionStartPos, EndPos );
            }
            else
            {
                var TopPos = SelectionStartPos;
                if ( SelectionStartPos.Compare( SelectionEndPos ) > 0 )
                    TopPos = SelectionEndPos;

                var LinePos  = this.Get_ParaPosByContentPos( TopPos );
                var CurLine  = LinePos.Line;
                var CurRange = LinePos.Range;

                // Пересчитаем координату точки TopPos
                this.Set_ParaContentPos( TopPos, false, CurLine, CurRange );

                this.Internal_Recalculate_CurPos(0, true, false, false );
                this.CurPos.RealX = this.CurPos.X;
                this.CurPos.RealY = this.CurPos.Y;

                this.Selection_Remove();

                if ( 0 == CurLine )
                {
                    return false;
                }
                else
                {
                    this.Cursor_MoveAt( this.CurPos.RealX, CurLine - 1, true, true );
                }
            }
        }
        else
        {
            var LinePos = this.Get_CurrentParaPos();
            var CurLine = LinePos.Line;

            if ( true === AddToSelect )
            {
                var StartPos = this.Get_ParaContentPos(false, false);
                var EndPos   = null;

                if ( 0 == CurLine )
                {
                    EndPos = this.Get_StartPos();

                    // Переходим в предыдущий элемент документа
                    Result = false;
                }
                else
                {
                    this.Cursor_MoveAt( this.CurPos.RealX, CurLine - 1, true, true );
                    EndPos = this.Get_ParaContentPos(false, false);
                }

                this.Selection.Use = true;
                this.Set_SelectionContentPos( StartPos, EndPos );
            }
            else
            {
                if ( 0 == CurLine )
                {
                    // Возвращяем значение false, это означает, что надо перейти в
                    // предыдущий элемент контента документа.
                    return false;
                }
                else
                {
                    this.Cursor_MoveAt( this.CurPos.RealX, CurLine - 1, true, true );
                }
            }
        }

        return Result;
    },

    Cursor_MoveDown : function(Count, AddToSelect)
    {
        var Result = true;
        if ( true === this.Selection.Use )
        {
            var SelectionStartPos = this.Get_ParaContentPos( true , true );
            var SelectionEndPos   = this.Get_ParaContentPos( true , false );

            if ( true === AddToSelect )
            {
                var LinePos = this.Get_ParaPosByContentPos( SelectionEndPos );
                var CurLine = LinePos.Line;

                if ( this.Lines.length - 1 == CurLine )
                {
                    EndPos = this.Get_EndPos(true);

                    // Переходим в предыдущий элемент документа
                    Result = false;
                }
                else
                {
                    this.Cursor_MoveAt( this.CurPos.RealX, CurLine + 1, true, true );
                    EndPos = this.Get_ParaContentPos(false, false);
                }

                this.Selection.Use = true;
                this.Set_SelectionContentPos( SelectionStartPos, EndPos );
            }
            else
            {
                var BottomPos = SelectionEndPos;
                if ( SelectionStartPos.Compare( SelectionEndPos ) > 0 )
                    BottomPos = SelectionStartPos;

                var LinePos  = this.Get_ParaPosByContentPos( BottomPos );
                var CurLine  = LinePos.Line;
                var CurRange = LinePos.Range;

                // Пересчитаем координату BottomPos
                this.Set_ParaContentPos( BottomPos, false, CurLine, CurRange );

                this.Internal_Recalculate_CurPos(0, true, false, false );
                this.CurPos.RealX = this.CurPos.X;
                this.CurPos.RealY = this.CurPos.Y;

                this.Selection_Remove();

                if ( this.Lines.length - 1 == CurLine )
                {
                    return false;
                }
                else
                {
                    this.Cursor_MoveAt( this.CurPos.RealX, CurLine + 1, true, true );
                }
            }
        }
        else
        {
            var LinePos = this.Get_CurrentParaPos();
            var CurLine = LinePos.Line;

            if ( true === AddToSelect )
            {
                var StartPos = this.Get_ParaContentPos(false, false);
                var EndPos   = null;

                if ( this.Lines.length - 1 == CurLine )
                {
                    EndPos = this.Get_EndPos(true);

                    // Переходим в предыдущий элемент документа
                    Result = false;
                }
                else
                {
                    this.Cursor_MoveAt( this.CurPos.RealX, CurLine + 1, true, true );
                    EndPos = this.Get_ParaContentPos(false, false);
                }

                this.Selection.Use = true;
                this.Set_SelectionContentPos( StartPos, EndPos );
            }
            else
            {
                if ( this.Lines.length - 1 == CurLine )
                {
                    // Возвращяем значение false, это означает, что надо перейти в
                    // предыдущий элемент контента документа.
                    return false;
                }
                else
                {
                    this.Cursor_MoveAt( this.CurPos.RealX, CurLine + 1, true, true );
                }
            }
        }

        return Result;
    },

    Cursor_MoveEndOfLine : function(AddToSelect)
    {
        if ( true === this.Selection.Use )
        {
            var EndSelectionPos   = this.Get_ParaContentPos( true, false );
            var StartSelectionPos = this.Get_ParaContentPos( true, true );

            if ( true === AddToSelect )
            {
                var SearchPos = new CParagraphSearchPos();
                this.Get_EndRangePos( SearchPos, EndSelectionPos );

                this.Set_SelectionContentPos( StartSelectionPos, SearchPos.Pos );
            }
            else
            {
                var RightPos = EndSelectionPos;
                if ( EndSelectionPos.Compare( StartSelectionPos ) < 0 )
                    RightPos = StartSelectionPos;

                var SearchPos  = new CParagraphSearchPos();
                this.Get_EndRangePos( SearchPos, RightPos );

                this.Selection_Remove();

                this.Set_ParaContentPos( SearchPos.Pos, false, SearchPos.Line, SearchPos.Range );
            }
        }
        else
        {
            var SearchPos  = new CParagraphSearchPos();
            var ContentPos = this.Get_ParaContentPos( false, false );
            this.Get_EndRangePos( SearchPos, ContentPos );

            if ( true === AddToSelect )
            {
                this.Selection.Use = true;
                this.Set_SelectionContentPos( ContentPos, SearchPos.Pos );
            }
            else
            {
                this.Set_ParaContentPos( SearchPos.Pos, false, SearchPos.Line, SearchPos.Range );
            }
        }

        // Обновляем текущую позицию X,Y. Если есть селект, тогда обновляем по концу селекта
        if ( true === this.Selection.Use )
        {
            var SelectionEndPos = this.Get_ParaContentPos( true, false );
            this.Set_ParaContentPos( SelectionEndPos, false, -1, -1 );
        }

        this.Internal_Recalculate_CurPos( this.CurPos.ContentPos, true, false, false );

        this.CurPos.RealX = this.CurPos.X;
        this.CurPos.RealY = this.CurPos.Y;
    },

    Cursor_MoveStartOfLine : function(AddToSelect)
    {
        if ( true === this.Selection.Use )
        {
            var EndSelectionPos   = this.Get_ParaContentPos( true, false );
            var StartSelectionPos = this.Get_ParaContentPos( true, true );

            if ( true === AddToSelect )
            {
                var SearchPos = new CParagraphSearchPos();
                this.Get_StartRangePos( SearchPos, EndSelectionPos );

                this.Set_SelectionContentPos( StartSelectionPos, SearchPos.Pos );
            }
            else
            {
                var LeftPos = StartSelectionPos;
                if ( StartSelectionPos.Compare( EndSelectionPos ) > 0 )
                    LeftPos = EndSelectionPos;

                var SearchPos  = new CParagraphSearchPos();
                this.Get_StartRangePos( SearchPos, LeftPos );

                this.Selection_Remove();

                this.Set_ParaContentPos( SearchPos.Pos, false, SearchPos.Line, SearchPos.Range );
            }
        }
        else
        {
            var SearchPos  = new CParagraphSearchPos();
            var ContentPos = this.Get_ParaContentPos( false, false );

            this.Get_StartRangePos( SearchPos, ContentPos );

            if ( true === AddToSelect )
            {
                this.Selection.Use = true;
                this.Set_SelectionContentPos( ContentPos, SearchPos.Pos );
            }
            else
            {
                this.Set_ParaContentPos( SearchPos.Pos, false, SearchPos.Line, SearchPos.Range );
            }
        }

        // Обновляем текущую позицию X,Y. Если есть селект, тогда обновляем по концу селекта
        if ( true === this.Selection.Use )
        {
            var SelectionEndPos = this.Get_ParaContentPos( true, false );
            this.Set_ParaContentPos( SelectionEndPos, false, -1, -1 );
        }

        this.Internal_Recalculate_CurPos( this.CurPos.ContentPos, true, false, false );

        this.CurPos.RealX = this.CurPos.X;
        this.CurPos.RealY = this.CurPos.Y;
    },

    Cursor_MoveToStartPos : function(AddToSelect)
    {
        if ( true === AddToSelect )
        {
            var StartPos = null;

            if ( true === this.Selection.Use )
                StartPos = this.Get_ParaContentPos( true, true );
            else
                StartPos = this.Get_ParaContentPos( false, false );

            var EndPos = this.Get_StartPos();

            this.Selection.Use   = true;
            this.Selection.Start = false;

            this.Set_SelectionContentPos( StartPos, EndPos );
        }
        else
        {
            this.Selection_Remove();

            this.CurPos.ContentPos = 0;
            this.Content[0].Cursor_MoveToStartPos();
            this.Correct_ContentPos(false);
            this.Correct_ContentPos2();
        }
    },

    Cursor_MoveToEndPos : function(AddToSelect, StartSelectFromEnd)
    {
        if ( true === AddToSelect )
        {
            var StartPos = null;

            if ( true === this.Selection.Use )
                StartPos = this.Get_ParaContentPos( true, true );
            else
                StartPos = this.Get_ParaContentPos( false, false );

            var EndPos = this.Get_EndPos(true);

            this.Selection.Use   = true;
            this.Selection.Start = false;

            this.Set_SelectionContentPos( StartPos, EndPos );
        }
        else
        {
            if ( true === StartSelectFromEnd )
            {
                this.Selection.Use   = true;
                this.Selection.Start = false;

                this.Selection.StartPos = this.Content.length - 1;
                this.Selection.EndPos   = this.Content.length - 1;

                this.CurPos.ContentPos  = this.Content.length - 1;

                this.Content[this.CurPos.ContentPos].Cursor_MoveToEndPos(true);
            }
            else
            {
                this.Selection_Remove();

                this.CurPos.ContentPos = this.Content.length - 1;
                this.Content[this.CurPos.ContentPos].Cursor_MoveToEndPos();
                this.Correct_ContentPos(false);
                this.Correct_ContentPos2();
            }
        }
    },

    Cursor_MoveToNearPos : function(NearPos)
    {
        this.Set_ParaContentPos( NearPos.ContentPos, true, -1, -1 );

        this.Selection.Use = true;
        this.Set_SelectionContentPos( NearPos.ContentPos, NearPos.ContentPos );

        var SelectionStartPos = this.Get_ParaContentPos( true, true );
        var SelectionEndPos   = this.Get_ParaContentPos( true, false );

        if ( 0 === SelectionStartPos.Compare( SelectionEndPos ) )
            this.Selection_Remove();
    },

    Cursor_MoveUp_To_LastRow : function(X, Y, AddToSelect)
    {
        this.CurPos.RealX = X;
        this.CurPos.RealY = Y;

        // Перемещаем курсор в последнюю строку, с позицией, самой близкой по X
        this.Cursor_MoveAt( X, this.Lines.length - 1, true, true, this.PageNum );

        if ( true === AddToSelect )
        {
            if ( false === this.Selection.Use )
            {
                this.Selection.Use = true;
                this.Set_SelectionContentPos( this.Get_EndPos(true), this.Get_ParaContentPos( false, false ) );
            }
            else
            {
                this.Set_SelectionContentPos( this.Get_ParaContentPos( true, true ), this.Get_ParaContentPos( false, false ) );
            }
        }
    },

    Cursor_MoveDown_To_FirstRow : function(X, Y, AddToSelect)
    {
        this.CurPos.RealX = X;
        this.CurPos.RealY = Y;

        // Перемещаем курсор в последнюю строку, с позицией, самой близкой по X
        var CurContentPos = this.Cursor_MoveAt( X, 0, true, true, this.PageNum );

        if ( true === AddToSelect )
        {
            if ( false === this.Selection.Use )
            {
                this.Selection.Use = true;
                this.Set_SelectionContentPos( this.Get_StartPos(), this.Get_ParaContentPos( false, false ) );
            }
            else
            {
                this.Set_SelectionContentPos( this.Get_ParaContentPos( true, true ), this.Get_ParaContentPos( false, false ) );
            }
        }
    },

    Cursor_MoveTo_Drawing : function(Id, bBefore)
    {
        if ( undefined === bBefore )
            bBefore = true;

        var ContentPos = new CParagraphContentPos();

        var ContentLen = this.Content.length;
        
        var bFind = false;
        
        for ( var CurPos = 0; CurPos < ContentLen; CurPos++ )
        {
            var Element = this.Content[CurPos];

            ContentPos.Update( CurPos, 0 );

            if ( true === Element.Get_PosByDrawing(Id, ContentPos, 1) )
            {
                bFind = true;
                break;
            }
        }

        if ( false === bFind || ContentPos.Depth <= 0 )
            return;

        if ( true != bBefore )
            ContentPos.Data[ContentPos.Depth - 1]++;

        this.Selection_Remove();
        this.Set_ParaContentPos(ContentPos, false, -1, -1);

        this.RecalculateCurPos();
        this.CurPos.RealX = this.CurPos.X;
        this.CurPos.RealY = this.CurPos.Y;
    },

    Set_ContentPos : function(Pos, bCorrectPos, Line)
    {
        this.CurPos.ContentPos = Math.max( 0, Math.min( this.Content.length - 1, Pos ) );
        this.CurPos.Line       = ( undefined === Line ? -1 : Line );

        if ( false != bCorrectPos )
            this.Internal_Correct_ContentPos();
    },

    Internal_Correct_ContentPos : function()
    {
        // 1. Ищем ближайший справа элемент
        //    Это делается для того, чтобы если мы находимся в конце гиперссылки выйти из нее.
        var Count = this.Content.length;
        var CurPos = this.CurPos.ContentPos;

        var TempPos = CurPos;
        while ( TempPos >= 0 && TempPos < Count && undefined === this.Content[TempPos].CurLine )
            TempPos--;

        var CurLine = ( this.CurPos.Line === -1 ?  ( TempPos >= 0 && TempPos < Count ? this.Content[TempPos].CurLine : -1 ) : this.CurPos.Line );

        while ( CurPos < Count - 1 )
        {
            var Item = this.Content[CurPos];
            var ItemType = Item.Type;

            if ( para_Text === ItemType || para_Space === ItemType || para_End === ItemType || para_Tab === ItemType || (para_Drawing === ItemType && true === Item.Is_Inline() ) || para_PageNum === ItemType || para_NewLine === ItemType || para_HyperlinkStart === ItemType || para_Math === ItemType )
                break;

            CurPos++;
        }

        // 2. Ищем ближайший слева (текcт, пробел, картинку, нумерацию и т.д.)
        //    Смещаемся к концу ближайшего левого элемента, чтобы продолжался набор с
        //    настройками левого ближайшего элемента.
        while ( CurPos > 0 )
        {
            CurPos--;
            var Item = this.Content[CurPos];
            var ItemType = Item.Type;
            var bEnd = false;

            if ( para_Text === ItemType || para_Space === ItemType || para_End === ItemType || para_Tab === ItemType || (para_Drawing === ItemType && true === Item.Is_Inline() ) || para_PageNum === ItemType || para_NewLine === ItemType || para_Math === ItemType )
            {
                this.CurPos.ContentPos = CurPos + 1;
                bEnd = true;
            }
            else if ( para_HyperlinkEnd === ItemType )
            {
                while ( CurPos < Count - 1 && para_TextPr === this.Content[CurPos + 1].Type )
                    CurPos++;

                this.CurPos.ContentPos = CurPos + 1;
                bEnd = true;
            }

            if ( true === bEnd )
            {
                TempPos = CurPos;
                while ( TempPos >= 0 && TempPos < Count && undefined === this.Content[TempPos].CurLine )
                    TempPos--;

                var NewLine = ( TempPos >= 0 && TempPos < Count ? this.Content[TempPos].CurLine : -1 );

                if ( NewLine != CurLine && -1 != CurLine )
                    this.CurPos.Line = CurLine;

                return;
            }
        }

        // 3. Если мы попали в начало параграфа, тогда пропускаем все TextPr
        if ( CurPos <= 0 )
        {
            CurPos = 0;
            while ( para_TextPr === this.Content[CurPos].Type || para_CollaborativeChangesEnd === this.Content[CurPos].Type || para_CollaborativeChangesStart === this.Content[CurPos].Type )
                CurPos++;

            this.CurPos.ContentPos = CurPos;
        }
    },

    Get_CurPosXY : function()
    {
        return { X : this.CurPos.RealX, Y : this.CurPos.RealY };
    },

    Is_SelectionUse : function()
    {
        return this.Selection.Use;
    },

    // Функция определяет начальную позицию курсора в параграфе
    Internal_GetStartPos : function()
    {
        var oPos = this.Internal_FindForward( 0, [para_PageNum, para_Drawing, para_Tab, para_Text, para_Space, para_NewLine, para_End, para_Math] );
        if ( true === oPos.Found )
            return oPos.LetterPos;

        return 0;
    },

    // Функция определяет конечную позицию в параграфе
    Internal_GetEndPos : function()
    {
        var Res = this.Internal_FindBackward( this.Content.length - 1, [para_End] );
        if ( true === Res.Found )
            return Res.LetterPos;

        return 0;
    },              

    Correct_Content : function(_StartPos, _EndPos)
    {
        // В данной функции мы корректируем содержимое параграфа:
        // 1. Спаренные пустые раны мы удаляем (удаляем 1 ран)
        // 2. Удаляем пустые гиперссылки
        // 3. Добавляем пустой ран в место, где нет рана (например, между двумя идущими подряд гиперссылками)
        // 4. Удаляем пустые комментарии

        var StartPos = ( undefined === _StartPos ? 0 : Math.max( _StartPos - 1, 0 ) );
        var EndPos   = ( undefined === _EndPos ? this.Content.length - 1 : Math.min( _EndPos + 1, this.Content.length - 1 ) );

        var CommentsToDelete = [];
        for ( var CurPos = EndPos; CurPos >= StartPos; CurPos-- )
        {
            var CurElement = this.Content[CurPos];

            if ( para_Hyperlink === CurElement.Type && true === CurElement.Is_Empty() )
            {
                this.Internal_Content_Remove( CurPos );
                CurPos++;
            }
            else if ( para_Comment === CurElement.Type && false === CurElement.Start )
            {
                var CommentId = CurElement.CommentId;
                for ( var CurPos2 = CurPos - 1; CurPos2 >= 0; CurPos2-- )
                {
                    var CurElement2 = this.Content[CurPos2];
                    
                    if ( para_Comment === CurElement2.Type && CommentId === CurElement2.CommentId )
                    {
                        CommentsToDelete.push( CommentId );
                        break;
                    }
                    else if ( true !== CurElement2.Is_Empty() )
                        break;
                }
                
            }
            else if ( para_Run !== CurElement.Type )
            {                                
                if ( CurPos === this.Content.length - 1 || para_Run !== this.Content[CurPos + 1].Type || CurPos === this.Content.length - 2 )
                {
                    var NewRun = new ParaRun(this);
                    this.Internal_Content_Add( CurPos + 1, NewRun );
                }

                // Для начального элемента проверим еще и предыдущий
                if ( StartPos === CurPos && ( 0 === CurPos || para_Run !== this.Content[CurPos - 1].Type  ) )
                {
                    var NewRun = new ParaRun(this);
                    this.Internal_Content_Add( CurPos, NewRun );
                }
            }
            else
            {
                // TODO (Para_End): Предпоследний элемент мы не проверяем, т.к. на ран с Para_End мы не ориентируемся
                if ( true === CurElement.Is_Empty() && CurPos < this.Content.length - 2 && para_Run === this.Content[CurPos + 1].Type )
                    this.Internal_Content_Remove( CurPos );
            }
        }

        var CommentsCount = CommentsToDelete.length;
        for ( var CommentIndex = 0; CommentIndex < CommentsCount; CommentIndex++ )
        {
            this.LogicDocument.Remove_Comment( CommentsToDelete[CommentIndex], true, false );
        }

        this.Correct_ContentPos2();
    },

    Apply_TextPr : function(TextPr, IncFontSize)
    {
        // Данная функция работает по следующему принципу: если задано выделение, тогда применяем настройки к
        // выделенной части, а если выделения нет, тогда в текущее положение вставляем пустой ран с заданными настройками
        // и переносим курсор в данный ран.

        if ( true === this.Selection.Use )
        {
            var StartPos = this.Selection.StartPos;
            var EndPos   = this.Selection.EndPos;

            if ( StartPos === EndPos )
            {
                var NewElements = this.Content[EndPos].Apply_TextPr( TextPr, IncFontSize, false );

                if ( para_Run === this.Content[EndPos].Type )
                {
                    var CenterRunPos = this.Internal_ReplaceRun( EndPos, NewElements );

                    // TODO: разобраться здесь получше, как правильно обновлять позицию
                    if ( StartPos === this.CurPos.ContentPos )
                        this.CurPos.ContentPos = CenterRunPos;

                    // Подправим селект
                    this.Selection.StartPos = CenterRunPos;
                    this.Selection.EndPos   = CenterRunPos;
                }
            }
            else
            {
                var Direction = 1;
                if ( StartPos > EndPos )
                {
                    var Temp = StartPos;
                    StartPos = EndPos;
                    EndPos = Temp;

                    Direction = -1;
                }

                for ( var CurPos = StartPos + 1; CurPos < EndPos; CurPos++ )
                {
                    this.Content[CurPos].Apply_TextPr( TextPr, IncFontSize, false );
                }

                var bCorrectContent = false;

                var NewElements = this.Content[EndPos].Apply_TextPr( TextPr, IncFontSize, false );
                if ( para_Run === this.Content[EndPos].Type )
                {
                    this.Internal_ReplaceRun( EndPos, NewElements );
                    bCorrectContent = true;
                }

                var NewElements = this.Content[StartPos].Apply_TextPr( TextPr, IncFontSize, false );
                if ( para_Run === this.Content[StartPos].Type )
                {
                    this.Internal_ReplaceRun( StartPos, NewElements );
                    bCorrectContent = true;
                }
                
                if ( true === bCorrectContent )
                    this.Correct_Content();
            }
        }
        else
        {
            var Pos = this.CurPos.ContentPos;
            var Element = this.Content[Pos];
            var NewElements = Element.Apply_TextPr( TextPr, IncFontSize, false );

            if ( para_Run === Element.Type )
            {
                var CenterRunPos = this.Internal_ReplaceRun( Pos, NewElements );
                this.CurPos.ContentPos = CenterRunPos;
                this.CurPos.Line       = -1;
            }
            
            if ( true === this.Cursor_IsEnd() )
            {
                if ( undefined === IncFontSize )
                    this.TextPr.Apply_TextPr( TextPr );
                else
                {
                    // Выставляем настройки для символа параграфа
                    var EndTextPr = this.Get_CompiledPr2(false).TextPr.Copy();
                    EndTextPr.Merge( this.TextPr.Value );

                    // TODO: Как только перенесем историю изменений TextPr в сам класс CTextPr, переделать тут
                    this.TextPr.Set_FontSize( FontSize_IncreaseDecreaseValue( IncFontSize, EndTextPr.FontSize ) );
                }
                
                // TODO (ParaEnd): Переделать 
                var LastElement = this.Content[this.Content.length - 1];
                if ( para_Run === Element.Type )
                {
                    LastElement.Set_Pr(this.TextPr.Value.Copy());
                }
            }            
        }
    },

    Internal_ReplaceRun : function(Pos, NewRuns)
    {
        // По логике, можно удалить Run, стоящий в позиции Pos и добавить все раны, которые не null в массиве NewRuns.
        // Но, согласно работе ParaRun.Apply_TextPr, в массиве всегда идет ровно 3 рана (возможно null). Второй ран
        // всегда не null. Первый не null ран и есть ран, идущий в позиции Pos.

        var LRun = NewRuns[0];
        var CRun = NewRuns[1];
        var RRun = NewRuns[2];

        // CRun - всегда не null
        var CenterRunPos = Pos;

        if ( null !== LRun )
        {
            this.Internal_Content_Add( Pos + 1, CRun );
            CenterRunPos = Pos + 1;
        }
        else
        {
            // Если LRun - null, значит CRun - это и есть тот ран который стоит уже в позиции Pos
        }

        if ( null !== RRun )
            this.Internal_Content_Add( CenterRunPos + 1, RRun );

        return CenterRunPos;
    },

    Check_Hyperlink : function(X, Y, PageNum)
    {
        var SearchPosXY = this.Get_ParaContentPosByXY( X, Y, PageNum, false, false );
        var CurPos = SearchPosXY.Pos.Get(0);

        if ( true === SearchPosXY.InText && para_Hyperlink === this.Content[CurPos].Type )
            return this.Content[CurPos];

        return null;
    },

    Hyperlink_Add : function(HyperProps)
    {
        if ( true === this.Selection.Use )
        {
            // Создаем гиперссылку
            var Hyperlink = new ParaHyperlink();

            // Заполняем гиперссылку полями
            if ( undefined != HyperProps.Value && null != HyperProps.Value )
                Hyperlink.Set_Value( HyperProps.Value );

            if ( undefined != HyperProps.ToolTip && null != HyperProps.ToolTip )
                Hyperlink.Set_ToolTip( HyperProps.ToolTip );

            // Разделяем содержимое по меткам селекта
            var StartContentPos = this.Get_ParaContentPos(true, true);
            var EndContentPos   = this.Get_ParaContentPos(true, false);

            if ( StartContentPos.Compare(EndContentPos) > 0 )
            {
                var Temp = StartContentPos;
                StartContentPos = EndContentPos;
                EndContentPos   = Temp;
            }
            
            // Если у нас попадает комментарий с данную область, тогда удалим его.
            // TODO: Переделать здесь, когда комментарии смогут лежать во всех классах (например в Hyperlink)

            var StartPos = StartContentPos.Get(0);
            var EndPos   = EndContentPos.Get(0);
            
            var CommentsToDelete = {};
            for (var Pos = StartPos; Pos <= EndPos; Pos++)
            {
                var Item = this.Content[Pos];
                if (para_Comment === Item.Type)
                    CommentsToDelete[Item.CommentId] = true;
            }

            for (var CommentId in CommentsToDelete)
            {
                this.LogicDocument.Remove_Comment( CommentId, true, false );
            }

            // Еще раз обновим метки
            StartContentPos = this.Get_ParaContentPos(true, true);
            EndContentPos   = this.Get_ParaContentPos(true, false);

            if ( StartContentPos.Compare(EndContentPos) > 0 )
            {
                var Temp = StartContentPos;
                StartContentPos = EndContentPos;
                EndContentPos   = Temp;
            }

            StartPos = StartContentPos.Get(0);
            EndPos   = EndContentPos.Get(0);

            // TODO: Как только избавимся от ParaEnd, здесь надо будет переделать.
            if ( this.Content.length - 1 === EndPos && true === this.Selection_CheckParaEnd() )
            {
                EndContentPos = this.Get_EndPos( false );
                EndPos        = EndContentPos.Get(0);
            }

            var NewElementE = this.Content[EndPos].Split( EndContentPos, 1 );
            var NewElementS = this.Content[StartPos].Split( StartContentPos, 1 );

            var HyperPos = 0;
            Hyperlink.Add_ToContent( HyperPos++, NewElementS );

            for ( var CurPos = StartPos + 1; CurPos <= EndPos; CurPos++ )
            {
                Hyperlink.Add_ToContent( HyperPos++, this.Content[CurPos] );
            }

            this.Internal_Content_Remove2( StartPos + 1, EndPos - StartPos );
            this.Internal_Content_Add( StartPos + 1, Hyperlink );
            this.Internal_Content_Add( StartPos + 2, NewElementE );

            this.Selection.StartPos = StartPos + 1;
            this.Selection.EndPos   = StartPos + 1;

            Hyperlink.Select_All();

            // Выставляем специальную текстовую настройку
            var TextPr = new CTextPr();
            TextPr.Color     = null;
            TextPr.Underline = null;
            TextPr.RStyle    = editor && editor.isDocumentEditor ? editor.WordControl.m_oLogicDocument.Get_Styles().Get_Default_Hyperlink() : null;
            if(!this.bFromDocument)
            {
                TextPr.Unifill = CreateUniFillSchemeColorWidthTint(11, 0);
                TextPr.Underline = true;
            }
            Hyperlink.Apply_TextPr( TextPr, undefined, false );
        }
        else if ( null !== HyperProps.Text && "" !== HyperProps.Text )
        {
            var ContentPos = this.Get_ParaContentPos(false, false);
            var CurPos = ContentPos.Get(0);

            var TextPr = this.Get_TextPr(ContentPos);

            // Создаем гиперссылку
            var Hyperlink = new ParaHyperlink();

            // Заполняем гиперссылку полями
            if ( undefined != HyperProps.Value && null != HyperProps.Value )
                Hyperlink.Set_Value( HyperProps.Value );

            if ( undefined != HyperProps.ToolTip && null != HyperProps.ToolTip )
                Hyperlink.Set_ToolTip( HyperProps.ToolTip );

            // Создаем текстовый ран в гиперссылке
            var HyperRun = new ParaRun(this);

            // Добавляем ран в гиперссылку
            Hyperlink.Add_ToContent( 0, HyperRun, false );

            // Задаем текстовые настройки рана (те, которые шли в текущей позиции + стиль гиперссылки)
            if(this.bFromDocument)
            {
                var Styles = editor.WordControl.m_oLogicDocument.Get_Styles();
                HyperRun.Set_Pr( TextPr.Copy() );
                HyperRun.Set_Color( undefined );
                HyperRun.Set_Underline( undefined );
                HyperRun.Set_RStyle( Styles.Get_Default_Hyperlink() );
            }
            else
            {
                HyperRun.Set_Pr( TextPr.Copy() );
                HyperRun.Set_Color( undefined );
                HyperRun.Set_Unifill( CreateUniFillSchemeColorWidthTint(11, 0) );
                HyperRun.Set_Underline( true );
            }

            // Заполняем ран гиперссылки текстом
            for ( var NewPos = 0; NewPos < HyperProps.Text.length; NewPos++ )
            {
                var Char = HyperProps.Text.charAt( NewPos );

                if ( " " == Char )
                    HyperRun.Add_ToContent( NewPos, new ParaSpace(), false );
                else
                    HyperRun.Add_ToContent( NewPos, new ParaText(Char), false );
            }

            // Разделяем текущий элемент (возвращается правая часть)
            var NewElement = this.Content[CurPos].Split( ContentPos, 1 );

            if ( null !== NewElement )
                this.Internal_Content_Add( CurPos + 1, NewElement );

            // Добавляем гиперссылку в содержимое параграфа
            this.Internal_Content_Add( CurPos + 1, Hyperlink );

            // Перемещаем кусор в конец гиперссылки
            this.CurPos.ContentPos = CurPos + 1;
            Hyperlink.Cursor_MoveToEndPos( false );
        }

        this.Correct_Content();
    },

    Hyperlink_Modify : function(HyperProps)
    {
        var HyperPos = -1;

        if ( true === this.Selection.Use )
        {
            var StartPos = this.Selection.StartPos;
            var EndPos   = this.Selection.EndPos;
            if ( StartPos > EndPos )
            {
                StartPos = this.Selection.EndPos;
                EndPos   = this.Selection.StartPos;
            }

            for ( var CurPos = StartPos; CurPos <= EndPos; CurPos++ )
            {
                var Element = this.Content[CurPos];

                if ( true !== Element.Selection_IsEmpty() && para_Hyperlink !== Element.Type )
                    break;
                else if ( true !== Element.Selection_IsEmpty() && para_Hyperlink === Element.Type )
                {
                    if ( -1 === HyperPos )
                        HyperPos = CurPos;
                    else
                        break;
                }
            }

            if ( this.Selection.StartPos === this.Selection.EndPos && para_Hyperlink === this.Content[this.Selection.StartPos].Type )
                HyperPos = this.Selection.StartPos;
        }
        else
        {
            if ( para_Hyperlink === this.Content[this.CurPos.ContentPos].Type )
                HyperPos = this.CurPos.ContentPos;
        }

        if ( -1 != HyperPos )
        {
            var Hyperlink = this.Content[HyperPos];

            if ( undefined != HyperProps.Value && null != HyperProps.Value )
                Hyperlink.Set_Value( HyperProps.Value );

            if ( undefined != HyperProps.ToolTip && null != HyperProps.ToolTip )
                Hyperlink.Set_ToolTip( HyperProps.ToolTip );

            if ( null != HyperProps.Text )
            {
                var TextPr = Hyperlink.Get_TextPr();

                // Удаляем все что было в гиперссылке
                Hyperlink.Remove_FromContent( 0, Hyperlink.Content.length );

                // Создаем текстовый ран в гиперссылке
                var HyperRun = new ParaRun(this);

                // Добавляем ран в гиперссылку
                Hyperlink.Add_ToContent( 0, HyperRun, false );

                // Задаем текстовые настройки рана (те, которые шли в текущей позиции + стиль гиперссылки)
                if(this.bFromDocument)
                {
                    var Styles = editor.WordControl.m_oLogicDocument.Get_Styles();
                    HyperRun.Set_Pr( TextPr.Copy() );
                    HyperRun.Set_Color( undefined );
                    HyperRun.Set_Underline( undefined );
                    HyperRun.Set_RStyle( Styles.Get_Default_Hyperlink() );
                }
                else
                {
                    HyperRun.Set_Pr( TextPr.Copy() );
                    HyperRun.Set_Color( undefined );
                    HyperRun.Set_Unifill( CreateUniFillSchemeColorWidthTint(11, 0) );
                    HyperRun.Set_Underline( true );
                }


                // Заполняем ран гиперссылки текстом
                for ( var NewPos = 0; NewPos < HyperProps.Text.length; NewPos++ )
                {
                    var Char = HyperProps.Text.charAt( NewPos );

                    if ( " " == Char )
                        HyperRun.Add_ToContent( NewPos, new ParaSpace(), false );
                    else
                        HyperRun.Add_ToContent( NewPos, new ParaText(Char), false );
                }

                // Перемещаем кусор в конец гиперссылки

                if ( true === this.Selection.Use )
                {
                    this.Selection.StartPos = HyperPos;
                    this.Selection.EndPos   = HyperPos;

                    Hyperlink.Select_All();
                }
                else
                {
                    this.CurPos.ContentPos = HyperPos;
                    Hyperlink.Cursor_MoveToEndPos( false );
                }

                return true;
            }

            return false;
        }

        return false;
    },

    Hyperlink_Remove : function()
    {
        // Сначала найдем гиперссылку, которую нужно удалить
        var HyperPos = -1;

        if ( true === this.Selection.Use )
        {
            var StartPos = this.Selection.StartPos;
            var EndPos   = this.Selection.EndPos;
            if ( StartPos > EndPos )
            {
                StartPos = this.Selection.EndPos;
                EndPos   = this.Selection.StartPos;
            }

            for ( var CurPos = StartPos; CurPos <= EndPos; CurPos++ )
            {
                var Element = this.Content[CurPos];

                if ( true !== Element.Selection_IsEmpty() && para_Hyperlink !== Element.Type )
                    break;
                else if ( true !== Element.Selection_IsEmpty() && para_Hyperlink === Element.Type )
                {
                    if ( -1 === HyperPos )
                        HyperPos = CurPos;
                    else
                        break;
                }
            }

            if ( this.Selection.StartPos === this.Selection.EndPos && para_Hyperlink === this.Content[this.Selection.StartPos].Type )
                HyperPos = this.Selection.StartPos;
        }
        else
        {
            if ( para_Hyperlink === this.Content[this.CurPos.ContentPos].Type )
                HyperPos = this.CurPos.ContentPos;
        }

        if ( -1 !== HyperPos )
        {
            var Hyperlink = this.Content[HyperPos];

            var ContentLen = Hyperlink.Content.length;

            this.Internal_Content_Remove( HyperPos );

            var TextPr = new CTextPr();
            TextPr.RStyle = null;
            if(!this.bFromDocument)
            {
                TextPr.Unifill = null;
                TextPr.Underline = null;
            }

            for ( var CurPos = 0; CurPos < ContentLen; CurPos++ )
            {
                var Element = Hyperlink.Content[CurPos];
                this.Internal_Content_Add( HyperPos + CurPos, Element );
                Element.Apply_TextPr(TextPr, undefined, true);
            }

            if ( true === this.Selection.Use )
            {
                this.Selection.StartPos = HyperPos + Hyperlink.State.Selection.StartPos;
                this.Selection.EndPos   = HyperPos + Hyperlink.State.Selection.EndPos;
            }
            else
            {
                this.CurPos.ContentPos = HyperPos + Hyperlink.State.ContentPos;
            }

            return true;
        }

        return false;
    },

    Hyperlink_CanAdd : function(bCheckInHyperlink)
    {
        if ( true === bCheckInHyperlink )
        {
            if ( true === this.Selection.Use )
            {
                // Если у нас в выделение попадает начало или конец гиперссылки, или конец параграфа, или
                // у нас все выделение находится внутри гиперссылки, тогда мы не можем добавить новую. Во
                // всех остальных случаях разрешаем добавить.

                var StartPos = this.Selection.StartPos;
                var EndPos   = this.Selection.EndPos;
                if ( EndPos < StartPos )
                {
                    StartPos = this.Selection.EndPos;
                    EndPos   = this.Selection.StartPos;
                }

                // Проверяем не находимся ли мы внутри гиперссылки

                for ( var CurPos = StartPos; CurPos <= EndPos; CurPos++ )
                {
                    var Element = this.Content[CurPos];
                    if ( para_Hyperlink === Element.Type /*|| true === Element.Selection_CheckParaEnd()*/ )
                        return false;
                }

                return true;
            }
            else
            {
                // Внутри гиперссылки мы не можем задать ниперссылку
                if ( para_Hyperlink === this.Content[this.CurPos.ContentPos].Type )
                    return false;
                else
                    return true;
            }
        }
        else
        {
            if ( true === this.Selection.Use )
            {
                // Если у нас в выделение попадает несколько гиперссылок или конец параграфа, тогда
                // возвращаем false, во всех остальных случаях true

                var StartPos = this.Selection.StartPos;
                var EndPos   = this.Selection.EndPos;
                if ( EndPos < StartPos )
                {
                    StartPos = this.Selection.EndPos;
                    EndPos   = this.Selection.StartPos;
                }

                var bHyper = false;

                for ( var CurPos = StartPos; CurPos <= EndPos; CurPos++ )
                {
                    var Element = this.Content[CurPos];
                    if ( (true === bHyper && para_Hyperlink === Element.Type) /*|| true === Element.Selection_CheckParaEnd()*/ )
                        return false;
                    else if ( true !== bHyper && para_Hyperlink === Element.Type )
                        bHyper = true;
                }

                return true;
            }
            else
            {
                return true;
            }
        }
    },

    Hyperlink_Check : function(bCheckEnd)
    {
        var Hyper = null;

        if ( true === this.Selection.Use )
        {
            // TODO: Если есть выделение, тогда Word не проверяем попадаение в гиперссылку 
            //var StartPos = this.Selection.StartPos;
            //var EndPos   = this.Selection.EndPos;

            //if ( StartPos > EndPos )
            //{
            //    StartPos = this.Selection.EndPos;
            //    EndPos   = this.Selection.StartPos;
            //}

            //for ( var CurPos = StartPos; CurPos <= EndPos; CurPos++ )
            //{
            //    var Element = this.Content[CurPos];

            //    if ( para_Hyperlink === Element.Type && true !== Element.Selection_IsEmpty() )
            //    {
            //        if ( null === Hyper )
            //            Hyper = Element;
            //        else
            //            return null;
            //    }
            //}
        }
        else
        {
            var Element = this.Content[this.CurPos.ContentPos];

            if ( para_Hyperlink === Element.Type )
                Hyper = Element;
        }

        return Hyper;
    },

    Selection_SetStart : function(X,Y,PageNum, bTableBorder)
    {
        // Избавляемся от старого селекта
        if ( true === this.Selection.Use )
            this.Selection_Remove();

        // Найдем позицию в контенте, в которую мы попали (для селекта ищем и за знаком параграфа, для курсора только перед)
        var SearchPosXY  = this.Get_ParaContentPosByXY( X, Y, PageNum, false, true );
        var SearchPosXY2 = this.Get_ParaContentPosByXY( X, Y, PageNum, false, false );

        // Начинаем селект
        this.Selection.Use      = true;
        this.Selection.Start    = true;
        this.Selection.Flag     = selectionflag_Common;
        this.Selection.StartManually = true;
        
        // Выставим текущую позицию
        this.Set_ParaContentPos( SearchPosXY2.Pos, true, SearchPosXY2.Line, SearchPosXY2.Range );

        // Выставляем селект
        this.Set_SelectionContentPos( SearchPosXY.Pos, SearchPosXY.Pos );
    },

    // Данная функция может использоваться как при движении, так и при окончательном выставлении селекта.
    // Если bEnd = true, тогда это конец селекта.
    Selection_SetEnd : function(X,Y,PageNum, MouseEvent, bTableBorder)
    {
        var PagesCount = this.Pages.length;

        if (this.bFromDocument && false === editor.isViewMode && null === this.Parent.Is_HdrFtr(true) && null == this.Get_DocumentNext() && PageNum - this.PageNum >= PagesCount - 1 && Y > this.Pages[PagesCount - 1].Bounds.Bottom && MouseEvent.ClickCount >= 2 )
            return this.Parent.Extend_ToPos( X, Y );

        // Обновляем позицию курсора
        this.CurPos.RealX = X;
        this.CurPos.RealY = Y;

        this.Selection.EndManually = true;

        // Найдем позицию в контенте, в которую мы попали (для селекта ищем и за знаком параграфа, для курсора только перед)
        var SearchPosXY  = this.Get_ParaContentPosByXY( X, Y, PageNum, false, true );
        var SearchPosXY2 = this.Get_ParaContentPosByXY( X, Y, PageNum, false, false );

        // Выставим в полученном месте текущую позицию курсора
        this.Set_ParaContentPos( SearchPosXY2.Pos, true, SearchPosXY2.Line, SearchPosXY2.Range );

        if ( true === SearchPosXY.End || true === this.Is_Empty() )
        {
            var LastRange = this.Lines[this.Lines.length - 1].Ranges[this.Lines[this.Lines.length - 1].Ranges.length - 1];
            if (  PageNum - this.PageNum >= PagesCount - 1 && X > LastRange.W && MouseEvent.ClickCount >= 2 && Y <= this.Pages[PagesCount - 1].Bounds.Bottom )
            {
                if ( this.bFromDocument && false === editor.isViewMode && false === editor.WordControl.m_oLogicDocument.Document_Is_SelectionLocked(changestype_None, { Type : changestype_2_Element_and_Type, Element : this, CheckType : changestype_Paragraph_Content } ) )
                {
                    History.Create_NewPoint();
                    History.Set_Additional_ExtendDocumentToPos();

                    if ( true === this.Extend_ToPos( X ) )
                    {
                        this.Cursor_MoveToEndPos();
                        this.Document_SetThisElementCurrent(true);
                        editor.WordControl.m_oLogicDocument.Recalculate();
                        return;
                    }
                    else
                        History.Remove_LastPoint();                    
                }
            }
        }

        // Выставляем селект
        this.Set_SelectionContentPos( this.Get_ParaContentPos( true, true ), SearchPosXY.Pos );

        var SelectionStartPos = this.Get_ParaContentPos( true, true );
        var SelectionEndPos   = this.Get_ParaContentPos( true, false );

        if ( 0 === SelectionStartPos.Compare( SelectionEndPos ) && g_mouse_event_type_up === MouseEvent.Type )
        {
            var NumPr = this.Numbering_Get();
            if ( true === SearchPosXY.Numbering && undefined != NumPr )
            {
                // Передвигаем курсор в начало параграфа
                this.Set_ParaContentPos(this.Get_StartPos(), true, -1, -1);

                // Производим выделение нумерации
                this.Parent.Document_SelectNumbering( NumPr );
            }
            else
            {
                var ClickCounter = MouseEvent.ClickCount % 2;

                if ( 1 >= MouseEvent.ClickCount )
                {
                    // Убираем селект. Позицию курсора можно не выставлять, т.к. она у нас установлена на конец селекта
                    this.Selection_Remove();
                }
                else if ( 0 == ClickCounter )
                {
                    // Выделяем слово, в котором находимся
                    var SearchPosS = new CParagraphSearchPos();
                    var SearchPosE = new CParagraphSearchPos();

                    this.Get_WordEndPos( SearchPosE, SearchPosXY.Pos );
                    this.Get_WordStartPos( SearchPosS, SearchPosE.Pos );                    

                    var StartPos = ( true === SearchPosS.Found ? SearchPosS.Pos : this.Get_StartPos() );
                    var EndPos   = ( true === SearchPosE.Found ? SearchPosE.Pos : this.Get_EndPos(false) );

                    this.Selection.Use = true;
                    this.Set_SelectionContentPos( StartPos, EndPos );
                }
                else // ( 1 == ClickCounter % 2 )
                {
                    // Выделяем весь параграф целиком

                    this.Select_All( 1 );
                }
            }
        }
    },

    Selection_Stop : function(X,Y,PageNum, MouseEvent)
    {
        this.Selection.Start = false;

        var StartPos = this.Selection.StartPos;
        var EndPos   = this.Selection.EndPos;

        if ( StartPos > EndPos )
        {
            StartPos = this.Selection.EndPos;
            EndPos   = this.Selection.StartPos;
        }

        for ( var CurPos = StartPos; CurPos <= EndPos; CurPos++ )
        {
            this.Content[CurPos].Selection_Stop();
        }
    },

    Selection_Remove : function()
    {
        if ( true === this.Selection.Use )
        {
            var StartPos = this.Selection.StartPos;
            var EndPos   = this.Selection.EndPos;

            if ( StartPos > EndPos )
            {
                StartPos = this.Selection.EndPos;
                EndPos   = this.Selection.StartPos;
            }

            StartPos = Math.max(0, StartPos);
            EndPos   = Math.min(this.Content.length - 1, EndPos);

            for ( var CurPos = StartPos; CurPos <= EndPos; CurPos++ )
            {
                this.Content[CurPos].Selection_Remove();
            }
        }

        this.Selection.Use      = false;
        this.Selection.Start    = false;
        this.Selection.Flag     = selectionflag_Common;
        this.Selection.StartPos = 0;
        this.Selection.EndPos   = 0;
        this.Selection_Clear();
    },

    Selection_Clear : function()
    {
    },

    Selection_Draw_Page : function(Page_abs)
    {
        if ( true != this.Selection.Use )
            return;

        var CurPage = Page_abs - this.Get_StartPage_Absolute();
        if ( CurPage < 0 || CurPage >= this.Pages.length )
            return;

        if ( 0 === CurPage && this.Pages[0].EndLine < 0 )
            return;

        switch ( this.Selection.Flag )
        {
            case selectionflag_Common:
            {
                // Делаем подсветку
                var StartPos = this.Selection.StartPos;
                var EndPos   = this.Selection.EndPos;

                if ( StartPos > EndPos )
                {
                    StartPos = this.Selection.EndPos;
                    EndPos   = this.Selection.StartPos;
                }

                var _StartLine = this.Pages[CurPage].StartLine;
                var _EndLine   = this.Pages[CurPage].EndLine;

                if ( StartPos > this.Lines[_EndLine].EndPos || EndPos < this.Lines[_StartLine].StartPos )
                    return;
                else
                {
                    StartPos = Math.max( StartPos, this.Lines[_StartLine].StartPos );
                    EndPos   = Math.min( EndPos,   ( _EndLine != this.Lines.length - 1 ? this.Lines[_EndLine].EndPos : this.Content.length - 1 ) );
                }

                var DrawSelection = new CParagraphDrawSelectionRange();

                var bInline = this.Is_Inline();

                for ( var CurLine = _StartLine; CurLine <= _EndLine; CurLine++ )
                {
                    var Line = this.Lines[CurLine];
                    var RangesCount = Line.Ranges.length;

                    // Определяем позицию и высоту строки
                    DrawSelection.StartY = this.Pages[CurPage].Y      + this.Lines[CurLine].Top;
                    DrawSelection.H      = this.Lines[CurLine].Bottom - this.Lines[CurLine].Top;

                    for ( var CurRange = 0; CurRange < RangesCount; CurRange++ )
                    {
                        var Range = Line.Ranges[CurRange];

                        var RStartPos = Range.StartPos;
                        var REndPos   = Range.EndPos;

                        // Если пересечение пустое с селектом, тогда пропускаем данный отрезок
                        if ( StartPos > REndPos || EndPos < RStartPos )
                            continue;

                        DrawSelection.StartX    = this.Lines[CurLine].Ranges[CurRange].XVisible;
                        DrawSelection.W         = 0;
                        DrawSelection.FindStart = true;

                        if ( CurLine === this.Numbering.Line && CurRange === this.Numbering.Range )
                            DrawSelection.StartX += this.Numbering.WidthVisible;

                        for ( var CurPos = RStartPos; CurPos <= REndPos; CurPos++ )
                        {
                            var Item = this.Content[CurPos];
                            Item.Selection_DrawRange( CurLine, CurRange, DrawSelection );
                        }

                        var StartX = DrawSelection.StartX;
                        var W      = DrawSelection.W;

                        var StartY = DrawSelection.StartY;
                        var H      = DrawSelection.H;
                        
                        if ( true !== bInline )
                        {
                            var Frame_X_min = this.CalculatedFrame.L2;
                            var Frame_Y_min = this.CalculatedFrame.T2;
                            var Frame_X_max = this.CalculatedFrame.L2 + this.CalculatedFrame.W2;
                            var Frame_Y_max = this.CalculatedFrame.T2 + this.CalculatedFrame.H2;
                                                        
                            StartX = Math.min( Math.max( Frame_X_min, StartX ), Frame_X_max );
                            StartY = Math.min( Math.max( Frame_Y_min, StartY ), Frame_Y_max );
                            W      = Math.min( W, Frame_X_max - StartX );
                            H      = Math.min( H, Frame_Y_max - StartY );
                        }

                        // Отрисовываем селект
                        if ( W > 0.001 )
                            this.DrawingDocument.AddPageSelection(Page_abs, StartX, StartY, W, H);
                    }
                }

                break;
            }
            case selectionflag_Numbering:
            {
                var ParaNum = this.Numbering;
                var NumberingRun = ParaNum.Run;

                if ( null === NumberingRun )
                    break;

                var CurLine  = ParaNum.Line;
                var CurRange = ParaNum.Range;
                
                if ( CurLine < this.Pages[CurPage].StartLine || CurLine > this.Pages[CurPage].EndLine )
                    break;

                var SelectY = this.Lines[CurLine].Top + this.Pages[CurPage].Y;
                var SelectX = this.Lines[CurLine].Ranges[CurRange].XVisible;
                var SelectW = ParaNum.WidthVisible;
                var SelectH = this.Lines[CurLine].Bottom - this.Lines[CurLine].Top;

                var NumPr   = this.Numbering_Get();
                var NumJc   = this.Parent.Get_Numbering().Get_AbstractNum( NumPr.NumId ).Lvl[NumPr.Lvl].Jc;

                switch ( NumJc )
                {
                    case align_Center:
                    {
                        SelectX = this.Lines[CurLine].Ranges[CurRange].XVisible - ParaNum.WidthNum / 2;
                        SelectW = ParaNum.WidthVisible + ParaNum.WidthNum / 2;
                        break;
                    }
                    case align_Right:
                    {
                        SelectX = this.Lines[CurLine].Ranges[CurRange].XVisible - ParaNum.WidthNum;
                        SelectW = ParaNum.WidthVisible + ParaNum.WidthNum;
                        break;
                    }
                    case align_Left:
                    default:
                    {
                        SelectX = this.Lines[CurLine].Ranges[CurRange].XVisible;
                        SelectW = ParaNum.WidthVisible;
                        break;
                    }
                }

                this.DrawingDocument.AddPageSelection( Page_abs, SelectX, SelectY, SelectW, SelectH );

                break;
            }
        }
    },

    Selection_CheckParaEnd : function()
    {
        if ( true !== this.Selection.Use )
            return false;

        var EndPos = ( this.Selection.StartPos > this.Selection.EndPos ? this.Selection.StartPos : this.Selection.EndPos );

        return this.Content[EndPos].Selection_CheckParaEnd();
    },

    Selection_Check : function(X, Y, Page_Abs, NearPos)
    {
        var SelSP = this.Get_ParaContentPos( true, true );
        var SelEP = this.Get_ParaContentPos( true, false );

        if ( SelSP.Compare( SelEP ) > 0 )
        {
            var Temp = SelSP;
            SelSP = SelEP;
            SelEP = Temp;
        }

        if ( undefined !== NearPos )
        {
            if ( this === NearPos.Paragraph && ( ( true === this.Selection.Use && ((NearPos.ContentPos.Compare( SelSP ) >= 0 && NearPos.ContentPos.Compare( SelEP ) <= 0) || (NearPos.SearchPos.Compare( SelSP ) >= 0 && NearPos.SearchPos.Compare( SelEP ) <= 0)) ) || true === this.ApplyToAll ) )
                return true;

            return false;
        }
        else
        {
            var PageIndex = Page_Abs - this.Get_StartPage_Absolute();
            if ( PageIndex < 0 || PageIndex >= this.Pages.length || true != this.Selection.Use )
                return false;

            var SearchPosXY = this.Get_ParaContentPosByXY( X, Y, PageIndex + this.PageNum, false, false );
            
            if ( true === SearchPosXY.InText )
            {
                var CurPos = SearchPosXY.InTextPos.Get(0);

                if ( SearchPosXY.InTextPos.Compare( SelSP ) >= 0 && SearchPosXY.InTextPos.Compare( SelEP ) <= 0 && ( para_Math !== this.Content[CurPos].Type || true !== this.Content[CurPos].Selection_IsPlaceholder() ) )
                    return true;
            }

            return false;
        }

        return false;
    },

    Selection_CalculateTextPr : function()
    {
        if ( true === this.Selection.Use || true === this.ApplyToAll )
        {
            var StartPos = this.Selection.StartPos;
            var EndPos   = this.Selection.EndPos;

            if ( true === this.ApplyToAll )
            {
                StartPos = 0;
                EndPos   = this.Content.length - 1;
            }

            if ( StartPos > EndPos )
            {
                var Temp = EndPos;
                EndPos   = StartPos;
                StartPos = Temp;
            }

            if ( EndPos >= this.Content.length )
                EndPos = this.Content.length - 1;
            if ( StartPos < 0 )
                StartPos = 0;

            if ( StartPos == EndPos )
                return this.Internal_CalculateTextPr( StartPos );

            while ( this.Content[StartPos].Type == para_TextPr )
                StartPos++;

            var oEnd = this.Internal_FindBackward( EndPos - 1, [ para_Text, para_Space ] );

            if ( oEnd.Found )
                EndPos = oEnd.LetterPos;
            else
            {
                while ( this.Content[EndPos].Type == para_TextPr )
                    EndPos--;
            }

            // Рассчитаем стиль в начале селекта
            var TextPr_start = this.Internal_CalculateTextPr( StartPos );
            var TextPr_vis   = TextPr_start;

            for ( var Pos = StartPos + 1; Pos < EndPos; Pos++ )
            {
                var Item = this.Content[Pos];
                if ( para_TextPr == Item.Type && Pos < this.Content.length - 1 && para_TextPr != this.Content[Pos + 1].Type )
                {
                    // Рассчитываем настройки в данной позиции
                    var TextPr_cur = this.Internal_CalculateTextPr( Pos );
                    TextPr_vis = TextPr_vis.Compare( TextPr_cur );
                }
            }

            return TextPr_vis;
        }
        else
            return new CTextPr();
    },

    Selection_SelectNumbering : function()
    {
        if ( undefined != this.Numbering_Get() )
        {
            this.Selection.Use  = true;
            this.Selection.Flag = selectionflag_Numbering;
        }
    },

    // Выставляем начало/конец селекта в начало/конец параграфа
    Selection_SetBegEnd : function(StartSelection, StartPara)
    {
        var ContentPos = ( true === StartPara ? this.Get_StartPos() : this.Get_EndPos(true) );

        if ( true === StartSelection )
        {
            this.Selection.StartManually = false;
            this.Set_SelectionContentPos( ContentPos, this.Get_ParaContentPos( true, false ) );
        }
        else
        {
            this.Selection.EndManually = false;
            this.Set_SelectionContentPos( this.Get_ParaContentPos( true, true ), ContentPos );
        }
    },

    Select_All : function(Direction)
    {
        var Count = this.Content.length;

        this.Selection.Use = true;

        var StartPos = null, EndPos = null;
        if ( -1 === Direction )
        {
            StartPos = this.Get_EndPos( true );
            EndPos   = this.Get_StartPos();
        }
        else
        {
            StartPos = this.Get_StartPos();
            EndPos   = this.Get_EndPos( true );
        }

        this.Selection.StartManually = false;
        this.Selection.EndManually   = false;
        
        this.Set_SelectionContentPos( StartPos, EndPos );
    },

    Get_SelectionAnchorPos : function()
    {
        var X0 = this.X, X1 = this.XLimit, Y = this.Y, Page = this.Get_StartPage_Absolute();
        if ( true === this.ApplyToAll )
        {            
            // Ничего не делаем
        }
        else if ( true === this.Selection.Use )
        {
            // Делаем подсветку
            var StartPos = this.Selection.StartPos;
            var EndPos   = this.Selection.EndPos;

            if ( StartPos > EndPos )
            {
                StartPos = this.Selection.EndPos;
                EndPos   = this.Selection.StartPos;
            }

            var LinesCount = this.Lines.length;
            var StartLine = -1;
            var EndLine   = -1;
            
            for (var CurLine = 0; CurLine < LinesCount; CurLine++ )
            {
                if ( -1 === StartLine && StartPos >= this.Lines[CurLine].StartPos && StartPos <= this.Lines[CurLine].EndPos )
                    StartLine = CurLine;
                
                if ( EndPos >= this.Lines[CurLine].StartPos && EndPos <= this.Lines[CurLine].EndPos )
                    EndLine = CurLine;
            }

            StartLine = Math.min( Math.max( 0, StartLine ), LinesCount - 1 );
            EndLine   = Math.min( Math.max( 0, EndLine   ), LinesCount - 1 );

            var PagesCount = this.Pages.length;
            var DrawSelection = new CParagraphDrawSelectionRange();

            for ( var CurLine = StartLine; CurLine <= EndLine; CurLine++ )
            {
                var Line = this.Lines[CurLine];                                
                var RangesCount = Line.Ranges.length;
                
                // Определим номер страницы
                var CurPage = 0;
                for (; CurPage < PagesCount; CurPage++ )
                {
                    if ( CurLine >= this.Pages[CurPage].StartLine && CurLine <= this.Pages[CurPage].EndLine )
                        break;
                }

                CurPage = Math.min( PagesCount - 1, CurPage );

                // Определяем позицию и высоту строки
                DrawSelection.StartY = this.Pages[CurPage].Y      + this.Lines[CurLine].Top;
                DrawSelection.H      = this.Lines[CurLine].Bottom - this.Lines[CurLine].Top;
                
                var Result = null;

                for ( var CurRange = 0; CurRange < RangesCount; CurRange++ )
                {
                    var Range = Line.Ranges[CurRange];

                    var RStartPos = Range.StartPos;
                    var REndPos   = Range.EndPos;

                    // Если пересечение пустое с селектом, тогда пропускаем данный отрезок
                    if ( StartPos > REndPos || EndPos < RStartPos )
                        continue;

                    DrawSelection.StartX    = this.Lines[CurLine].Ranges[CurRange].XVisible;
                    DrawSelection.W         = 0;
                    DrawSelection.FindStart = true;

                    if ( CurLine === this.Numbering.Line && CurRange === this.Numbering.Range )
                        DrawSelection.StartX += this.Numbering.WidthVisible;

                    for ( var CurPos = RStartPos; CurPos <= REndPos; CurPos++ )
                    {
                        var Item = this.Content[CurPos];
                        Item.Selection_DrawRange( CurLine, CurRange, DrawSelection );
                    }

                    var StartX = DrawSelection.StartX;
                    var W      = DrawSelection.W;

                    var StartY = DrawSelection.StartY;
                    var H      = DrawSelection.H;

                    var StartX = DrawSelection.StartX;
                    var W      = DrawSelection.W;

                    var StartY = DrawSelection.StartY;
                    var H      = DrawSelection.H;

                    if ( W > 0.001 )
                    {
                        X0 = StartX;
                        X1 = StartX + W;
                        Y  = StartY;

                        Page = CurPage + this.Get_StartPage_Absolute();

                        if ( null === Result )
                            Result = { X0 : X0, X1 : X1, Y : Y, Page : Page };
                        else
                        {
                            Result.X0 = Math.min( Result.X0, X0 );
                            Result.X1 = Math.max( Result.X1, X1 );
                        }
                    }
                }
                
                if ( null !== Result )
                {
                    return Result;
                }
            }            
        }
        else
        {
            // Текущая точка
            X0   = this.CurPos.X;
            X1   = this.CurPos.X;
            Y    = this.CurPos.Y;
            Page = this.Get_StartPage_Absolute() + this.CurPos.PagesPos;
        }

        return { X0 : X0, X1 : X1, Y : Y, Page : this.Get_StartPage_Absolute() };
    },

    // Возвращаем выделенный текст
    Get_SelectedText : function(bClearText)
    {
        var Str = "";
        var Count = this.Content.length;        
        for ( var Pos = 0; Pos < Count; Pos++ )
        {
            var _Str = this.Content[Pos].Get_SelectedText( true === this.ApplyToAll, bClearText );

            if ( null === _Str )
                return null;

            Str += _Str;     
        }
        
        return Str;
    },

    Get_SelectedElementsInfo : function(Info)
    {
        Info.Set_Paragraph( this );
    },

    Get_SelectedContent : function(DocContent)
    {
        if ( true !== this.Selection.Use )
            return;

        var StartPos = this.Selection.StartPos;
        var EndPos   = this.Selection.EndPos;
        if ( StartPos > EndPos )
        {
            StartPos = this.Selection.EndPos;
            EndPos   = this.Selection.StartPos;
        }

        var Para = null;
        if ( true === this.Selection_IsFromStart() && true === this.Selection_CheckParaEnd() )
        {
            Para = this.Copy(this.Parent);
            DocContent.Add( new CSelectedElement( Para, true ) );
        }
        else
        {
            Para = new Paragraph(this.DrawingDocument, this.Parent, 0, 0, 0, 0, 0);

            // Копируем настройки
            Para.Set_Pr(this.Pr.Copy());
            Para.TextPr.Set_Value( this.TextPr.Value.Copy() );

            // Копируем содержимое параграфа
            for ( var Pos = StartPos; Pos <= EndPos; Pos++ )
            {
                var Item = this.Content[Pos];

                if ( StartPos === Pos || EndPos === Pos )
                    Para.Internal_Content_Add( Pos - StartPos, Item.Copy(true), false );
                else
                    Para.Internal_Content_Add( Pos - StartPos, Item.Copy(false), false );
            }

            // Добавляем секцию в конце
            if ( undefined !== this.SectPr )
            {
                var SectPr = new CSectionPr(this.SectPr.LogicDocument);
                SectPr.Copy(this.SectPr);
                Para.Set_SectionPr(SectPr);
            }
            DocContent.Add( new CSelectedElement( Para, false ) );
        }
    },

    Get_Paragraph_TextPr : function()
    {
        var TextPr;
        if ( true === this.ApplyToAll )
        {
            this.Select_All(1);

            var StartPos = 0;
            var Count = this.Content.length;
            while (true !== this.Content[StartPos].Is_CursorPlaceable() && StartPos < Count - 1)
                StartPos++;
            
            TextPr = this.Content[StartPos].Get_CompiledTextPr(true);
            var Count = this.Content.length;

            for ( var CurPos = StartPos + 1; CurPos < Count; CurPos++ )
            {
                var TempTextPr = this.Content[CurPos].Get_CompiledTextPr(false);
                if ( null !== TempTextPr && undefined !== TempTextPr && true !== this.Content[CurPos].Selection_IsEmpty() )
                    TextPr = TextPr.Compare( TempTextPr );
            }
            
            this.Selection_Remove();
        }
        else
        {
            if ( true === this.Selection.Use )
            {
                var StartPos = this.Selection.StartPos;
                var EndPos   = this.Selection.EndPos;

                if ( StartPos > EndPos )
                {
                    StartPos = this.Selection.EndPos;
                    EndPos   = this.Selection.StartPos;
                }
                
                // TODO: Как только избавимся от para_End переделать здесь.
                
                if ( StartPos === EndPos && this.Content.length - 1 === EndPos )
                {
                    TextPr = this.Get_CompiledPr2(false).TextPr.Copy();
                    TextPr.Merge(this.TextPr.Value);
                }
                else
                {
                    var bCheckParaEnd = false;
                    if ( this.Content.length - 1 === EndPos )
                    {
                        EndPos--;
                        bCheckParaEnd = true;
                    }

                    // Сначала пропускаем все пустые элементы. После этой операции мы можем попасть в элемент, в котором
                    // нельзя находиться курсору, поэтому ищем в обратном направлении первый подходящий элемент.
                    var OldStartPos = StartPos;
                    while ( true === this.Content[StartPos].Selection_IsEmpty() && StartPos < EndPos )
                        StartPos++;

                    while (true !== this.Content[StartPos].Is_CursorPlaceable() && StartPos > OldStartPos)
                        StartPos--;

                    TextPr = this.Content[StartPos].Get_CompiledTextPr(true);

                    // Если все-так так сложилось, что мы находимся в элементе без настроек, тогда берем настройки для
                    // символа конца параграфа.
                    if (null === TextPr)
                    {
                        TextPr = this.Get_CompiledPr2(false).TextPr.Copy();
                        TextPr.Merge(this.TextPr.Value);
                    }

                    for ( var CurPos = StartPos + 1; CurPos <= EndPos; CurPos++ )
                    {
                        var TempTextPr = this.Content[CurPos].Get_CompiledTextPr(false);

                        if ( null === TextPr || undefined === TextPr )
                            TextPr = TempTextPr;
                        else if ( null !== TempTextPr && undefined !== TempTextPr && true !== this.Content[CurPos].Selection_IsEmpty() )
                            TextPr = TextPr.Compare( TempTextPr );
                    }

                    if ( true === bCheckParaEnd )
                    {
                        var EndTextPr = this.Get_CompiledPr2(false).TextPr.Copy();
                        EndTextPr.Merge(this.TextPr.Value);
                        TextPr = TextPr.Compare( EndTextPr );
                    }
                }
            }
            else
            {
                TextPr = this.Content[this.CurPos.ContentPos].Get_CompiledTextPr(true);
            }
        }
        
        if ( null === TextPr || undefined === TextPr )
            TextPr = this.TextPr.Value.Copy();

        // TODO: Пока возвращаем всегда шрифт лежащий в Ascii, в будущем надо будет это переделать
        if ( undefined !== TextPr.RFonts && null !== TextPr.RFonts )
            TextPr.FontFamily = TextPr.RFonts.Ascii;

        return TextPr;
    },

    // Проверяем пустой ли параграф
    IsEmpty : function()
    {
        var ContentLen = this.Content.length;
        for ( var CurPos = 0; CurPos < ContentLen; CurPos++ )
        {
            if ( false === this.Content[CurPos].Is_Empty( { SkipEnd : true } ) )
                return false;
        }

        return true;
    },
    
    Is_Empty : function()
    {
        return this.IsEmpty();
    },

    // Проверяем, попали ли мы в текст
    Is_InText : function(X, Y, PageNum_Abs)
    {
        var PageNum = PageNum_Abs - this.Get_StartPage_Absolute();
        if ( PageNum < 0 || PageNum >= this.Pages.length )
            return null;

        var SearchPosXY = this.Get_ParaContentPosByXY( X, Y, PageNum, false, false );
        if ( true === SearchPosXY.InText )
            return this;

        return null;
    },

    Is_UseInDocument : function()
    {
        if ( null != this.Parent )
            return this.Parent.Is_UseInDocument(this.Get_Id());

        return false;
    },

    // Проверяем пустой ли селект
    Selection_IsEmpty : function(bCheckHidden)
    {
        if ( undefined === bCheckHidden )
            bCheckHidden = true;

        if ( true === this.Selection.Use )
        {
            var StartPos = this.Selection.StartPos;
            var EndPos   = this.Selection.EndPos;

            if ( StartPos > EndPos )
            {
                EndPos   = this.Selection.StartPos;
                StartPos = this.Selection.EndPos;
            }

            for ( var CurPos = StartPos; CurPos <= EndPos; CurPos++ )
            {
                if ( true !== this.Content[CurPos].Selection_IsEmpty(bCheckHidden) )
                    return false;
            }
        }

        return true;
    },

//-----------------------------------------------------------------------------------
// Функции для работы с нумерацией параграфов в документах
//-----------------------------------------------------------------------------------

    Get_StartTabsCount : function(TabsCounter)
    {
        var ContentLen = this.Content.length;
        for ( var Pos = 0; Pos < ContentLen; Pos++ )
        {
            var Element = this.Content[Pos];
            if ( false === Element.Get_StartTabsCount( TabsCounter ) )
                return false;
        }
        
        return true;
    },
    
    Remove_StartTabs : function(TabsCounter)
    {
        var ContentLen = this.Content.length;
        for ( var Pos = 0; Pos < ContentLen; Pos++ )
        {
            var Element = this.Content[Pos];
            if ( false === Element.Remove_StartTabs( TabsCounter ) )
                return false;
        }
        
        return true;
    },
    
    // Добавляем нумерацию к данному параграфу
    Numbering_Add : function(NumId, Lvl)
    {
        var ParaPr = this.Get_CompiledPr2(false).ParaPr;
        var NumPr_old = this.Numbering_Get();

        this.Numbering_Remove();

        var SelectionUse       = this.Is_SelectionUse();
        var SelectedOneElement = (this.Parent.Selection_Is_OneElement() === 0 ? true : false );

        // Рассчитаем количество табов, идущих в начале параграфа
        var TabsCounter = new CParagraphTabsCounter();
        this.Get_StartTabsCount( TabsCounter );
        
        var TabsCount = TabsCounter.Count;
        var TabsPos   = TabsCounter.Pos;
        
        // Рассчитаем левую границу и сдвиг первой строки с учетом начальных табов
        var X = ParaPr.Ind.Left + ParaPr.Ind.FirstLine;
        var LeftX = X;

        if ( TabsCount > 0 && ParaPr.Ind.FirstLine < 0 )
        {
            X     = ParaPr.Ind.Left;
            LeftX = X;
            TabsCount--;
        }

        var ParaTabsCount = ParaPr.Tabs.Get_Count();
        while ( TabsCount )
        {
            // Ищем ближайший таб

            var TabFound = false;
            for ( var TabIndex = 0; TabIndex < ParaTabsCount; TabIndex++ )
            {
                var Tab = ParaPr.Tabs.Get(TabIndex);

                if ( Tab.Pos > X )
                {
                    X = Tab.Pos;
                    TabFound = true;
                    break;
                }
            }

            // Ищем по дефолтовому сдвигу
            if ( false === TabFound )
            {
                var NewX = 0;
                while ( X >= NewX )
                    NewX += Default_Tab_Stop;

                X = NewX;
            }

            TabsCount--;
        }

        var Numbering   = this.Parent.Get_Numbering();
        var AbstractNum = Numbering.Get_AbstractNum(NumId);

        // Если у параграфа не было никакой нумерации изначально
        if ( undefined === NumPr_old )
        {
            if ( true === SelectedOneElement || false === SelectionUse )
            {
                // Проверим сначала предыдущий элемент, если у него точно такая же нумерация, тогда копируем его сдвиги
                var Prev = this.Get_DocumentPrev();
                var PrevNumbering = ( null != Prev ? (type_Paragraph === Prev.GetType() ? Prev.Numbering_Get() : undefined) : undefined );
                if ( undefined != PrevNumbering && NumId === PrevNumbering.NumId && Lvl === PrevNumbering.Lvl )
                {
                    var NewFirstLine = Prev.Pr.Ind.FirstLine;
                    var NewLeft      = Prev.Pr.Ind.Left;
                    History.Add( this, { Type : historyitem_Paragraph_Ind_First, Old : ( undefined != this.Pr.Ind.FirstLine ? this.Pr.Ind.FirstLine : undefined ), New : NewFirstLine } );
                    History.Add( this, { Type : historyitem_Paragraph_Ind_Left,  Old : ( undefined != this.Pr.Ind.Left      ? this.Pr.Ind.Left      : undefined ), New : NewLeft } );

                    // При добавлении списка в параграф, удаляем все собственные сдвиги
                    this.Pr.Ind.FirstLine = NewFirstLine;
                    this.Pr.Ind.Left      = NewLeft;
                }
                else
                {
                    // Выставляем заданную нумерацию и сдвиги Ind.Left = X + NumPr.ParaPr.Ind.Left
                    var NumLvl = AbstractNum.Lvl[Lvl];
                    var NumParaPr = NumLvl.ParaPr;

                    if ( undefined != NumParaPr.Ind && undefined != NumParaPr.Ind.Left )
                    {
                        AbstractNum.Change_LeftInd( X + NumParaPr.Ind.Left );

                        History.Add( this, { Type : historyitem_Paragraph_Ind_First, Old : ( undefined != this.Pr.Ind.FirstLine ? this.Pr.Ind.FirstLine : undefined ), New : undefined } );
                        History.Add( this, { Type : historyitem_Paragraph_Ind_Left,  Old : ( undefined != this.Pr.Ind.Left      ? this.Pr.Ind.Left      : undefined ), New : undefined } );

                        // При добавлении списка в параграф, удаляем все собственные сдвиги
                        this.Pr.Ind.FirstLine = undefined;
                        this.Pr.Ind.Left      = undefined;
                    }
                }

                this.Pr.NumPr = new CNumPr();
                this.Pr.NumPr.Set( NumId, Lvl );
                History.Add( this, { Type : historyitem_Paragraph_Numbering, Old : NumPr_old, New : this.Pr.NumPr } );
            }
            else
            {
                // Если выделено несколько параграфов, тогда уже по сдвигу X определяем уровень данной нумерации

                var LvlFound = -1;
                var LvlsCount = AbstractNum.Lvl.length;
                for ( var LvlIndex = 0; LvlIndex < LvlsCount; LvlIndex++ )
                {
                    var NumLvl = AbstractNum.Lvl[LvlIndex];
                    var NumParaPr = NumLvl.ParaPr;

                    if ( undefined != NumParaPr.Ind && undefined != NumParaPr.Ind.Left && X <= NumParaPr.Ind.Left )
                    {
                        LvlFound = LvlIndex;
                        break;
                    }
                }

                if ( -1 === LvlFound )
                    LvlFound = LvlsCount - 1;

                if ( undefined != this.Pr.Ind && undefined != NumParaPr.Ind && undefined != NumParaPr.Ind.Left )
                {
                    History.Add( this, { Type : historyitem_Paragraph_Ind_First, Old : ( undefined != this.Pr.Ind.FirstLine ? this.Pr.Ind.FirstLine : undefined ), New : undefined } );
                    History.Add( this, { Type : historyitem_Paragraph_Ind_Left,  Old : ( undefined != this.Pr.Ind.Left      ? this.Pr.Ind.Left      : undefined ), New : undefined } );

                    // При добавлении списка в параграф, удаляем все собственные сдвиги
                    this.Pr.Ind.FirstLine = undefined;
                    this.Pr.Ind.Left      = undefined;
                }

                this.Pr.NumPr = new CNumPr();
                this.Pr.NumPr.Set( NumId, LvlFound );
                History.Add( this, { Type : historyitem_Paragraph_Numbering, Old : NumPr_old, New : this.Pr.NumPr } );
            }

            // Удалим все табы идущие в начале параграфа
            TabsCounter.Count = TabsCount;
            this.Remove_StartTabs( TabsCounter );
        }
        else
        {
            // просто меняем список, так чтобы он не двигался
            this.Pr.NumPr = new CNumPr();
            this.Pr.NumPr.Set( NumId, Lvl );

            History.Add( this, { Type : historyitem_Paragraph_Numbering, Old : NumPr_old, New : this.Pr.NumPr } );

            var Left      = ( NumPr_old.Lvl === Lvl ? undefined : ParaPr.Ind.Left );
            var FirstLine = ( NumPr_old.Lvl === Lvl ? undefined : ParaPr.Ind.FirstLine );

            History.Add( this, { Type : historyitem_Paragraph_Ind_First, Old : ( undefined != this.Pr.Ind.FirstLine ? this.Pr.Ind.FirstLine : undefined ), New : Left      } );
            History.Add( this, { Type : historyitem_Paragraph_Ind_Left,  Old : ( undefined != this.Pr.Ind.Left      ? this.Pr.Ind.Left      : undefined ), New : FirstLine } );

            this.Pr.Ind.FirstLine = FirstLine;
            this.Pr.Ind.Left      = Left;
        }

        // Если у параграфа выставлен стиль, тогда не меняем его, если нет, тогда выставляем стандартный
        // стиль для параграфа с нумерацией.
        if ( undefined === this.Style_Get() )
        {
            if(this.bFromDocument)
                this.Style_Add( this.Parent.Get_Styles().Get_Default_ParaList() );
        }

        // Надо пересчитать конечный стиль
        this.CompiledPr.NeedRecalc = true;
    },

    // Добавляем нумерацию к данному параграфу, не делая никаких дополнительных действий
    Numbering_Set : function(NumId, Lvl)
    {
        var NumPr_old = this.Pr.NumPr;
        this.Pr.NumPr = new CNumPr();
        this.Pr.NumPr.Set( NumId, Lvl );

        History.Add( this, { Type : historyitem_Paragraph_Numbering, Old : NumPr_old, New : this.Pr.NumPr } );

        // Надо пересчитать конечный стиль
        this.CompiledPr.NeedRecalc = true;
    },

    // Изменяем уровень нумерации
    Numbering_IndDec_Level : function(bIncrease)
    {
        var NumPr = this.Numbering_Get();
        if ( undefined != NumPr )
        {
            var NewLvl;
            if ( true === bIncrease )
                NewLvl = Math.min( 8, NumPr.Lvl + 1 );
            else
                NewLvl = Math.max( 0, NumPr.Lvl - 1 );

            this.Pr.NumPr = new CNumPr();
            this.Pr.NumPr.Set( NumPr.NumId, NewLvl );

            History.Add( this, { Type : historyitem_Paragraph_Numbering, Old : NumPr, New : this.Pr.NumPr } );

            // Надо пересчитать конечный стиль
            this.CompiledPr.NeedRecalc = true;
        }
    },

    // Добавление нумерации в параграф при открытии и копировании
    Numbering_Add_Open : function(NumId, Lvl)
    {
        this.Pr.NumPr = new CNumPr();
        this.Pr.NumPr.Set( NumId, Lvl );

        // Надо пересчитать конечный стиль
        this.CompiledPr.NeedRecalc = true;
    },

    Numbering_Get : function()
    {
        var NumPr = this.Get_CompiledPr2(false).ParaPr.NumPr;
        if ( undefined != NumPr && 0 != NumPr.NumId )
            return NumPr.Copy();

        return undefined;
    },

    // Удаляем нумерацию
    Numbering_Remove : function()
    {
        // Если у нас была задана нумерации в стиле, тогда чтобы ее отменить(не удаляя нумерацию в стиле)
        // мы проставляем NumPr с NumId undefined
        var OldNumPr = this.Numbering_Get();
        var NewNumPr = undefined;
        if ( undefined != this.CompiledPr.Pr.ParaPr.StyleNumPr )
        {
            NewNumPr = new CNumPr();
            NewNumPr.Set( 0, 0 );
        }        

        History.Add( this, { Type : historyitem_Paragraph_Numbering, Old : undefined != this.Pr.NumPr ? this.Pr.NumPr : undefined, New : NewNumPr } );
        this.Pr.NumPr = NewNumPr;

        if ( undefined != this.Pr.Ind && undefined != OldNumPr )
        {
            // При удалении нумерации из параграфа, если отступ первой строки > 0, тогда
            // увеличиваем левый отступ параграфа, а первую сторку  делаем 0, а если отступ
            // первой строки < 0, тогда просто делаем оступ первой строки 0.

            if ( undefined === this.Pr.Ind.FirstLine || Math.abs( this.Pr.Ind.FirstLine ) < 0.001 )
            {
                if ( undefined != OldNumPr && undefined != OldNumPr.NumId )
                {
                    var Lvl = this.Parent.Get_Numbering().Get_AbstractNum(OldNumPr.NumId).Lvl[OldNumPr.Lvl];
                    if ( undefined != Lvl && undefined != Lvl.ParaPr.Ind && undefined != Lvl.ParaPr.Ind.Left )
                    {
                        var CurParaPr = this.Get_CompiledPr2(false).ParaPr;
                        var Left = CurParaPr.Ind.Left  + CurParaPr.Ind.FirstLine;
                        var NumLeftCorrection = ( undefined != Lvl.ParaPr.Ind.FirstLine ?  Math.abs( Lvl.ParaPr.Ind.FirstLine ) : 0 );

                        History.Add( this, { Type : historyitem_Paragraph_Ind_Left,  New : Left, Old : this.Pr.Ind.Left } );
                        History.Add( this, { Type : historyitem_Paragraph_Ind_First, New : 0,    Old : this.Pr.Ind.FirstLine } );
                        this.Pr.Ind.Left      = Left - NumLeftCorrection;
                        this.Pr.Ind.FirstLine = 0;
                    }
                }
            }
            else if ( this.Pr.Ind.FirstLine < 0 )
            {
                History.Add( this, { Type : historyitem_Paragraph_Ind_First, New : 0, Old : this.Pr.Ind.FirstLine } );
                this.Pr.Ind.FirstLine = 0;
            }
            else if ( undefined != this.Pr.Ind.Left && this.Pr.Ind.FirstLine > 0 )
            {
                History.Add( this, { Type : historyitem_Paragraph_Ind_Left,  New : this.Pr.Ind.Left + this.Pr.Ind.FirstLine, Old : this.Pr.Ind.Left } );
                History.Add( this, { Type : historyitem_Paragraph_Ind_First, New : 0, Old : this.Pr.Ind.FirstLine } );
                this.Pr.Ind.Left += this.Pr.Ind.FirstLine;
                this.Pr.Ind.FirstLine = 0;
            }
        }

        // При удалении проверяем стиль. Если данный стиль является стилем по умолчанию
        // для параграфов с нумерацией, тогда удаляем запись и о стиле.
        var StyleId = this.Style_Get();
        var NumStyleId = this.Parent.Get_Styles().Get_Default_ParaList();
        if ( StyleId === NumStyleId )
            this.Style_Remove();

        // Надо пересчитать конечный стиль
        this.CompiledPr.NeedRecalc = true;
    },

    // Используется ли заданная нумерация в параграфе
    Numbering_IsUse: function(NumId, Lvl)
    {
        var bLvl = (undefined === Lvl ? false : true);

        var NumPr = this.Numbering_Get();
        if ( undefined != NumPr && NumId === NumPr.NumId && ( false === bLvl || Lvl === NumPr.Lvl ) )
            return true;

        return false;
    },

//-----------------------------------------------------------------------------------
// Функции для работы с нумерацией параграфов в презентациях
//-----------------------------------------------------------------------------------
    // Добавляем нумерацию к данному параграфу
    Add_PresentationNumbering : function(_Bullet)
    {

        var ParaPr = this.Get_CompiledPr2(false).ParaPr;
        var OldType = ParaPr.Bullet ? ParaPr.Bullet.getBulletType() : numbering_presentationnumfrmt_None;
        var NewType = _Bullet ? _Bullet.getBulletType() : numbering_presentationnumfrmt_None;

        var Bullet = _Bullet ? _Bullet.createDuplicate() : undefined;
        History.Add( this, { Type : historyitem_Paragraph_PresentationPr_Bullet, New : Bullet, Old : this.Pr.Bullet } );
        this.Pr.Bullet = Bullet;
        this.CompiledPr.NeedRecalc = true;
        if ( OldType != NewType )
        {
            var ParaPr = this.Get_CompiledPr2(false).ParaPr;
            var LeftInd = Math.min( ParaPr.Ind.Left, ParaPr.Ind.Left + ParaPr.Ind.FirstLine );

            if ( numbering_presentationnumfrmt_None === NewType )
            {
                this.Set_Ind( { FirstLine : 0, Left : LeftInd } );
            }
            else if ( numbering_presentationnumfrmt_RomanLcPeriod === NewType || numbering_presentationnumfrmt_RomanUcPeriod === NewType )
            {
                this.Set_Ind( { Left : LeftInd + 15.9, FirstLine : -15.9 } );
            }
            else
            {
                this.Set_Ind( { Left : LeftInd + 14.3, FirstLine : -14.3 } );
            }
        }
    },

    Get_PresentationNumbering : function()
    {
        this.Get_CompiledPr2(false);
        return this.PresentationPr.Bullet;
    },

    // Удаляем нумерацию
    Remove_PresentationNumbering : function()
    {
        this.Add_PresentationNumbering(undefined);
    },

    Set_PresentationLevel : function(Level)
    {
        if ( this.Pr.Lvl != Level )
        {
            History.Add( this, { Type : historyitem_Paragraph_PresentationPr_Level, Old : this.Pr.Lvl, New : Level } );
            this.Pr.Lvl = Level;
            this.CompiledPr.NeedRecalc = true;
            this.Recalc_RunsCompiledPr();
        }
    },
//-----------------------------------------------------------------------------------

    // Формируем конечные свойства параграфа на основе стиля, возможной нумерации и прямых настроек.
    // Также учитываем настройки предыдущего и последующего параграфов.
    Get_CompiledPr : function()
    {
        var Pr = this.Get_CompiledPr2();

        // При формировании конечных настроек параграфа, нужно учитывать предыдущий и последующий
        // параграфы. Например, для формирования интервала между параграфами.
        // max(Prev.After, Cur.Before) - реальное значение расстояния между параграфами.
        // Поэтому Prev.After = Prev.After (значение не меняем), а вот Cur.Before = max(Prev.After, Cur.Before) - Prev.After
        
        var StyleId = this.Style_Get();
        var NumPr   = this.Numbering_Get();
        var FramePr = this.Get_FramePr();

        var PrevEl  = this.Get_DocumentPrev();
        var NextEl  = this.Get_DocumentNext();

        // Предыдущий и последующий параграфы - это не обязательно именно предыдущий и последующий. Если данный параграф 
        // находится в рамке, тогда надо искать предыдущий и последующий только в текущей рамке, а если мы вне рамки, тогда
        // надо пропускать все параграфы находящиеся в рамке.
        if ( undefined !== FramePr )
        {
            if ( null === PrevEl || type_Paragraph !== PrevEl.GetType() )
                PrevEl = null
            else
            {
                var PrevFramePr = PrevEl.Get_FramePr();
                if ( undefined === PrevFramePr || true !== FramePr.Compare( PrevFramePr ) )
                    PrevEl = null;
            }

            if ( null === NextEl || type_Paragraph !== NextEl.GetType() )
                NextEl = null;
            else
            {
                var NextFramePr = NextEl.Get_FramePr();
                if ( undefined === NextFramePr || true !== FramePr.Compare( NextFramePr ) )
                    NextEl = null;
            }
        }
        else
        {
            while ( null !== PrevEl && type_Paragraph === PrevEl.GetType() && undefined !== PrevEl.Get_FramePr() )
                PrevEl = PrevEl.Get_DocumentPrev();
            
            while ( null !== NextEl && type_Paragraph === NextEl.GetType() && undefined !== NextEl.Get_FramePr() )
                NextEl = NextEl.Get_DocumentNext();            
        }

        if ( null != PrevEl && type_Paragraph === PrevEl.GetType() )
        {
            var PrevStyle      = PrevEl.Style_Get();
            var Prev_Pr        = PrevEl.Get_CompiledPr2(false).ParaPr;
            var Prev_After     = Prev_Pr.Spacing.After;
            var Prev_AfterAuto = Prev_Pr.Spacing.AfterAutoSpacing;
            var Cur_Before     = Pr.ParaPr.Spacing.Before;
            var Cur_BeforeAuto = Pr.ParaPr.Spacing.BeforeAutoSpacing;
            var Prev_NumPr     = PrevEl.Numbering_Get();

            if ( PrevStyle === StyleId && true === Pr.ParaPr.ContextualSpacing )
            {
                Pr.ParaPr.Spacing.Before = 0;
            }
            else
            {
                if ( true === Cur_BeforeAuto && PrevStyle === StyleId && undefined != Prev_NumPr && undefined != NumPr && Prev_NumPr.NumId === NumPr.NumId )
                    Pr.ParaPr.Spacing.Before = 0;
                else
                {
                    Cur_Before = this.Internal_CalculateAutoSpacing( Cur_Before, Cur_BeforeAuto, this );
                    Prev_After = this.Internal_CalculateAutoSpacing( Prev_After, Prev_AfterAuto, this );

                    if ( true === Prev_Pr.ContextualSpacing && PrevStyle === StyleId )
                        Prev_After = 0;

                    Pr.ParaPr.Spacing.Before = Math.max( Prev_After, Cur_Before ) - Prev_After;
                }
            }

            if ( false === this.Internal_Is_NullBorders(Pr.ParaPr.Brd) && true === this.Internal_CompareBrd( Prev_Pr, Pr.ParaPr ) && undefined === PrevEl.Get_SectionPr() )
                Pr.ParaPr.Brd.First = false;
            else
                Pr.ParaPr.Brd.First = true;
        }
        else if ( null === PrevEl )
        {
            if ( true === this.Parent.Is_TableCellContent() && true === Pr.ParaPr.ContextualSpacing  )
            {
                var Cell = this.Parent.Parent;
                var PrevEl = Cell.Get_LastParagraphPrevCell();
                
                if ( (null !== PrevEl && type_Paragraph === PrevEl.GetType() && PrevEl.Style_Get() === StyleId) || (null === PrevEl && undefined === StyleId) )
                {
                    Pr.ParaPr.Spacing.Before = 0;
                }
            }
            else if ( true === Pr.ParaPr.Spacing.BeforeAutoSpacing )
            {
                Pr.ParaPr.Spacing.Before = 0;
            }
        }
        else if ( type_Table === PrevEl.GetType() )
        {
            if ( true === Pr.ParaPr.Spacing.BeforeAutoSpacing )
            {
                Pr.ParaPr.Spacing.Before = 14 * g_dKoef_pt_to_mm;
            }
        }

        if ( null != NextEl )
        {
            if ( type_Paragraph === NextEl.GetType() )
            {
                var NextStyle       = NextEl.Style_Get();
                var Next_Pr         = NextEl.Get_CompiledPr2(false).ParaPr;
                var Next_Before     = Next_Pr.Spacing.Before;
                var Next_BeforeAuto = Next_Pr.Spacing.BeforeAutoSpacing;
                var Cur_After       = Pr.ParaPr.Spacing.After;
                var Cur_AfterAuto   = Pr.ParaPr.Spacing.AfterAutoSpacing;
                var Next_NumPr      = NextEl.Numbering_Get();

                if ( NextStyle === StyleId && true === Pr.ParaPr.ContextualSpacing )
                {
                    Pr.ParaPr.Spacing.After = 0;
                }
                else
                {
                    if ( true === Cur_AfterAuto && NextStyle === StyleId && undefined != Next_NumPr && undefined != NumPr && Next_NumPr.NumId === NumPr.NumId )
                        Pr.ParaPr.Spacing.After = 0;
                    else
                    {
                        Pr.ParaPr.Spacing.After = this.Internal_CalculateAutoSpacing( Cur_After, Cur_AfterAuto, this );
                    }
                }

                if ( false === this.Internal_Is_NullBorders(Pr.ParaPr.Brd) && true === this.Internal_CompareBrd( Next_Pr, Pr.ParaPr ) && undefined === this.Get_SectionPr() && (undefined === NextEl.Get_SectionPr() || true !== NextEl.IsEmpty() ) )
                    Pr.ParaPr.Brd.Last = false;
                else
                    Pr.ParaPr.Brd.Last = true;
            }
            else if ( type_Table === NextEl.GetType() )
            {
                var TableFirstParagraph = NextEl.Get_FirstParagraph();
                if ( null != TableFirstParagraph && undefined != TableFirstParagraph )
                {
                    var NextStyle           = TableFirstParagraph.Style_Get();
                    var Next_Before         = TableFirstParagraph.Get_CompiledPr2(false).ParaPr.Spacing.Before;
                    var Next_BeforeAuto     = TableFirstParagraph.Get_CompiledPr2(false).ParaPr.Spacing.BeforeAutoSpacing;
                    var Cur_After           = Pr.ParaPr.Spacing.After;
                    var Cur_AfterAuto       = Pr.ParaPr.Spacing.AfterAutoSpacing;
                    if ( NextStyle === StyleId && true === Pr.ParaPr.ContextualSpacing )
                    {
                        Cur_After   = this.Internal_CalculateAutoSpacing( Cur_After,   Cur_AfterAuto,   this );
                        Next_Before = this.Internal_CalculateAutoSpacing( Next_Before, Next_BeforeAuto, this );

                        Pr.ParaPr.Spacing.After = Math.max( Next_Before, Cur_After ) - Cur_After;
                    }
                    else
                    {
                        Pr.ParaPr.Spacing.After = this.Internal_CalculateAutoSpacing( Pr.ParaPr.Spacing.After, Cur_AfterAuto, this );
                    }
                }
            }
        }
        else
        {
            if ( true === this.Parent.Is_TableCellContent() && true === Pr.ParaPr.ContextualSpacing  )
            {
                var Cell = this.Parent.Parent;
                var NextEl = Cell.Get_FirstParagraphNextCell();

                if ( (null !== NextEl && type_Paragraph === NextEl.GetType() && NextEl.Style_Get() === StyleId) || (null === NextEl && StyleId === undefined) )
                {
                    Pr.ParaPr.Spacing.After = 0;
                }
            }
            else
                Pr.ParaPr.Spacing.After = this.Internal_CalculateAutoSpacing( Pr.ParaPr.Spacing.After, Pr.ParaPr.Spacing.AfterAutoSpacing, this );
        }

        return Pr;
    },

    Recalc_CompiledPr : function()
    {
        this.CompiledPr.NeedRecalc = true;
    },
    
    Recalc_RunsCompiledPr : function()
    {
        var Count = this.Content.length;
        for (var Pos = 0; Pos < Count; Pos++)
        {
            var Element = this.Content[Pos];
            
            if (Element.Recalc_RunsCompiledPr)
                Element.Recalc_RunsCompiledPr();
        }
    },    

    // Формируем конечные свойства параграфа на основе стиля, возможной нумерации и прямых настроек.
    // Без пересчета расстояния между параграфами.
    Get_CompiledPr2 : function(bCopy)
    {
        this.Internal_CompileParaPr();

        if ( false === bCopy )
            return this.CompiledPr.Pr;
        else
        {
            // Отдаем копию объекта, чтобы никто не поменял извне настройки скомпилированного стиля
            var Pr = {};
            Pr.TextPr = this.CompiledPr.Pr.TextPr.Copy();
            Pr.ParaPr = this.CompiledPr.Pr.ParaPr.Copy();
            return Pr;
        }
    },
    
    Internal_CompileParaPr : function()
    {
        if ( true === this.CompiledPr.NeedRecalc )
        {
            if ( undefined !== this.Parent && null !== this.Parent )
            {
                this.CompiledPr.Pr = this.Internal_CompileParaPr2();
                if(!this.bFromDocument)
                {
                    this.PresentationPr.Level = isRealNumber(this.Pr.Lvl) ? this.Pr.Lvl : 0;
                    this.PresentationPr.Bullet =  this.CompiledPr.Pr.ParaPr.Get_PresentationBullet();
                    this.Numbering.Bullet = this.PresentationPr.Bullet;
                }
                this.CompiledPr.NeedRecalc = false;
            }
            else
            {
                if ( undefined === this.CompiledPr.Pr || null === this.CompiledPr.Pr )
                {
                    this.CompiledPr.Pr =
                    {
                        ParaPr : new CParaPr(),
                        TextPr : new CTextPr()
                    };
                    this.CompiledPr.Pr.ParaPr.Init_Default();
                    this.CompiledPr.Pr.TextPr.Init_Default();
                }

                this.CompiledPr.NeedRecalc = true;
            }
        }
    },

    // Формируем конечные свойства параграфа на основе стиля, возможной нумерации и прямых настроек.
    Internal_CompileParaPr2 : function()
    {
        if(this.bFromDocument)
        {
            var Styles     = this.Parent.Get_Styles();
            var Numbering  = this.Parent.Get_Numbering();
            var TableStyle = this.Parent.Get_TableStyleForPara();
            var ShapeStyle = this.Parent.Get_ShapeStyleForPara();
            var StyleId    = this.Style_Get();

            // Считываем свойства для текущего стиля
            var Pr = Styles.Get_Pr( StyleId, styletype_Paragraph, TableStyle, ShapeStyle );

            // Если в стиле была задана нумерация сохраним это в специальном поле
            if ( undefined != Pr.ParaPr.NumPr )
                Pr.ParaPr.StyleNumPr = Pr.ParaPr.NumPr.Copy();

            var Lvl = -1;
            if ( undefined != this.Pr.NumPr )
            {
                if ( undefined != this.Pr.NumPr.NumId && 0 != this.Pr.NumPr.NumId )
                {
                    Lvl = this.Pr.NumPr.Lvl;

                    if ( Lvl >= 0 && Lvl <= 8 )
                        Pr.ParaPr.Merge( Numbering.Get_ParaPr( this.Pr.NumPr.NumId, this.Pr.NumPr.Lvl ) );
                    else
                    {
                        Lvl = -1;
                        Pr.ParaPr.NumPr = undefined;
                    }
                }
            }
            else if ( undefined != Pr.ParaPr.NumPr )
            {
                if ( undefined != Pr.ParaPr.NumPr.NumId && 0 != Pr.ParaPr.NumPr.NumId )
                {
                    var AbstractNum = Numbering.Get_AbstractNum( Pr.ParaPr.NumPr.NumId );
                    Lvl = AbstractNum.Get_LvlByStyle( StyleId );
                    if ( -1 != Lvl )
                    {}
                    else
                        Pr.ParaPr.NumPr = undefined;
                }
            }

            Pr.ParaPr.StyleTabs = ( undefined != Pr.ParaPr.Tabs ? Pr.ParaPr.Tabs.Copy() : new CParaTabs() );

            // Копируем прямые настройки параграфа.
            Pr.ParaPr.Merge( this.Pr );

            if ( -1 != Lvl && undefined != Pr.ParaPr.NumPr )
                Pr.ParaPr.NumPr.Lvl = Lvl;

            // Настройки рамки не наследуются
            if ( undefined === this.Pr.FramePr )
                Pr.ParaPr.FramePr = undefined;
            else
                Pr.ParaPr.FramePr = this.Pr.FramePr.Copy();

            return Pr;
        }
        else
        {
            return this.Internal_CompiledParaPrPresentation();
        }
    },

    Internal_CompiledParaPrPresentation: function(Lvl)
    {
        var _Lvl = isRealNumber(Lvl) ? Lvl : (isRealNumber(this.Pr.Lvl) ? this.Pr.Lvl : 0);
        var styleObject = this.Parent.Get_Styles(_Lvl);
        var Styles     = styleObject.styles;

        // Считываем свойства для текущего стиля
        var TableStyle = this.Parent.Get_TableStyleForPara();
        var Pr = Styles.Get_Pr( styleObject.lastId, styletype_Paragraph, TableStyle);

        if(TableStyle && TableStyle.TextPr)
        {
            var TextPr2 = new CTextPr();
            TextPr2.Unifill = TableStyle.TextPr.Unifill;
            TextPr2.RFonts = TableStyle.TextPr.RFonts;
            Pr.TextPr.Merge(TextPr2);
        }

        Pr.ParaPr.StyleTabs = ( undefined != Pr.ParaPr.Tabs ? Pr.ParaPr.Tabs.Copy() : new CParaTabs() );

        // Копируем прямые настройки параграфа.
        Pr.ParaPr.Merge( this.Pr );
        if(this.Pr.DefaultRunPr)
            Pr.TextPr.Merge( this.Pr.DefaultRunPr );
        Pr.TextPr.Color.Auto = false;

        return Pr;
    },
    // Сообщаем параграфу, что ему надо будет пересчитать скомпилированный стиль
    // (Такое может случится, если у данного параграфа есть нумерация или задан стиль,
    //  которые меняются каким-то внешним образом)
    Recalc_CompileParaPr : function()
    {
        this.CompiledPr.NeedRecalc = true;
    },

    Internal_CalculateAutoSpacing : function(Value, UseAuto, Para)
    {
        var Result = Value;
        if ( true === UseAuto )
        {
            if ( true === Para.Parent.Is_TableCellContent() )
                Result = 0;
            else
                Result = 14 * g_dKoef_pt_to_mm;
        }

        return Result;
    },
    
    Get_Paragraph_TextPr_Copy : function()
    {             
        var TextPr;
        if ( true === this.ApplyToAll )
        {
            this.Select_All(1);

            var Count = this.Content.length;
            var StartPos = 0;
            while ( true === this.Content[StartPos].Selection_IsEmpty() && StartPos < Count )
                StartPos++;

            TextPr = this.Content[StartPos].Get_CompiledTextPr(true);

            this.Selection_Remove();
        }
        else
        {
            if ( true === this.Selection.Use )
            {
                var StartPos = this.Selection.StartPos;
                var EndPos   = this.Selection.EndPos;

                if ( StartPos > EndPos )
                {
                    StartPos = this.Selection.EndPos;
                    EndPos   = this.Selection.StartPos;
                }

                while ( true === this.Content[StartPos].Selection_IsEmpty() && StartPos < EndPos )
                    StartPos++;

                TextPr = this.Content[StartPos].Get_CompiledTextPr(true);
            }
            else
            {
                TextPr = this.Content[this.CurPos.ContentPos].Get_CompiledTextPr(true);
            }
        }

        return TextPr;
    },

    Get_Paragraph_ParaPr_Copy : function()
    {
        var ParaPr = this.Pr.Copy();
        return ParaPr;
    },

    Paragraph_Format_Paste : function(TextPr, ParaPr, ApplyPara)
    {
        // Применяем текстовые настройки всегда
        if ( null != TextPr )
            this.Add( new ParaTextPr( TextPr ) );

        var _ApplyPara = ApplyPara;
        if ( false === _ApplyPara )
        {
            if ( true === this.Selection.Use )
            {
                _ApplyPara = true;

                var Start = this.Selection.StartPos;
                var End   = this.Selection.EndPos;
                if ( Start > End )
                {
                    Start = this.Selection.EndPos;
                    End   = this.Selection.StartPos;
                }

                if ( true === this.Internal_FindForward( End, [para_PageNum, para_Drawing, para_Tab, para_Text, para_Space, para_NewLine, para_End, para_Math]).Found )
                    _ApplyPara = false;
                else if ( true === this.Internal_FindBackward( Start - 1, [para_PageNum, para_Drawing, para_Tab, para_Text, para_Space, para_NewLine, para_End, para_Math]).Found )
                    _ApplyPara = false;
            }
            else
                _ApplyPara = true;
        }

        // Применяем настройки параграфа
        if ( true === _ApplyPara && null != ParaPr )
        {
            // Ind
            if ( undefined != ParaPr.Ind )
                this.Set_Ind( ParaPr.Ind, false );

            // Jc
            if ( undefined != ParaPr.Jc )
                this.Set_Align( ParaPr.Jc );

            // Spacing
            if ( undefined != ParaPr.Spacing )
                this.Set_Spacing( ParaPr.Spacing, false );

            // PageBreakBefore
            if ( undefined != ParaPr.PageBreakBefore )
                this.Set_PageBreakBefore( ParaPr.PageBreakBefore );

            // KeepLines
            if ( undefined != ParaPr.KeepLines )
                this.Set_KeepLines( ParaPr.KeepLines );

            // ContextualSpacing
            if ( undefined != ParaPr.ContextualSpacing )
                this.Set_ContextualSpacing( ParaPr.ContextualSpacing );

            // Shd
            if ( undefined != ParaPr.Shd )
                this.Set_Shd( ParaPr.Shd, false );

            if(this.bFromDocument)
            {
                // NumPr
                if ( undefined != ParaPr.NumPr )
                    this.Numbering_Set( ParaPr.NumPr.NumId, ParaPr.NumPr.Lvl );
                else
                    this.Numbering_Remove();

                // StyleId
                if ( undefined != ParaPr.PStyle )
                    this.Style_Add( ParaPr.PStyle, true );
                else
                    this.Style_Remove();

                // Brd
                if ( undefined != ParaPr.Brd )
                    this.Set_Borders( ParaPr.Brd );
            }

        }
    },

    Style_Get : function()
    {
        if ( undefined != this.Pr.PStyle )
            return this.Pr.PStyle;

        return undefined;
    },

    Style_Add : function(Id, bDoNotDeleteProps)
    {
        this.RecalcInfo.Set_Type_0(pararecalc_0_All);

        var Id_old = this.Pr.PStyle;
        if ( undefined === this.Pr.PStyle )
            Id_old = null;
        else
            this.Style_Remove();

        if ( null === Id )
            return;

        // Если стиль является стилем по умолчанию для параграфа, тогда не надо его записывать.
        if ( Id != this.Parent.Get_Styles().Get_Default_Paragraph() )
        {
            History.Add( this, { Type : historyitem_Paragraph_PStyle, Old : Id_old, New : Id } );
            this.Pr.PStyle = Id;
        }

        // Надо пересчитать конечный стиль самого параграфа и всех текстовых блоков
        this.CompiledPr.NeedRecalc = true;
        this.Recalc_RunsCompiledPr();

        if ( true === bDoNotDeleteProps )
            return;

        // TODO: По мере добавления элементов в стили параграфа и текста добавить их обработку здесь.

        // Не удаляем форматирование, при добавлении списка к данному параграфу
        var DefNumId = this.Parent.Get_Styles().Get_Default_ParaList();
        if ( Id != DefNumId && ( Id_old != DefNumId || Id != this.Parent.Get_Styles().Get_Default_Paragraph() ) )
        {
            this.Numbering_Remove();
            this.Set_ContextualSpacing( undefined );
            this.Set_Ind( new CParaInd(), true );
            this.Set_Align( undefined );
            this.Set_KeepLines( undefined );
            this.Set_KeepNext( undefined );
            this.Set_PageBreakBefore( undefined );
            this.Set_Spacing( new CParaSpacing(), true );
            this.Set_Shd( undefined, true );
            this.Set_WidowControl( undefined );
            this.Set_Tabs( new CParaTabs() );
            this.Set_Border( undefined, historyitem_Paragraph_Borders_Between );
            this.Set_Border( undefined, historyitem_Paragraph_Borders_Bottom );
            this.Set_Border( undefined, historyitem_Paragraph_Borders_Left );
            this.Set_Border( undefined, historyitem_Paragraph_Borders_Right );
            this.Set_Border( undefined, historyitem_Paragraph_Borders_Top );

            // При изменении стиля убираются только те текстовые настроки внутри параграфа,
            // которые присутствуют в стиле. Пока мы удалим вообще все настроки.
            // TODO : переделать

            for ( var Index = 0; Index < this.Content.length; Index++ )
            {
                this.Content[Index].Clear_TextPr();
            }

            this.TextPr.Clear_Style();
        }        
    },

    // Добавление стиля в параграф при открытии и копировании
    Style_Add_Open : function(Id)
    {
        this.Pr.PStyle = Id;

        // Надо пересчитать конечный стиль
        this.CompiledPr.NeedRecalc = true;
    },

    Style_Remove : function()
    {
        if ( undefined != this.Pr.PStyle )
        {
            History.Add( this, { Type : historyitem_Paragraph_PStyle, Old : this.Pr.PStyle, New : undefined } );
            this.Pr.PStyle = undefined;
        }

        // Надо пересчитать конечный стиль
        this.CompiledPr.NeedRecalc = true;
        this.Recalc_RunsCompiledPr();
    },

    // Проверяем находится ли курсор в конце параграфа
    Cursor_IsEnd : function(_ContentPos)
    {
        // Просто попробуем переместится вправо от текущего положения, если мы не можем, значит
        // мы стоим в конце параграфа.

        var ContentPos = ( undefined === _ContentPos ? this.Get_ParaContentPos( false, false ) : _ContentPos );
        var SearchPos  = new CParagraphSearchPos();

        this.Get_RightPos( SearchPos, ContentPos, false );

        if ( true === SearchPos.Found )
            return false;
        else
            return true;
    },

    // Проверяем находится ли курсор в начале параграфа
    Cursor_IsStart : function(_ContentPos)
    {
        // Просто попробуем переместится вправо от текущего положения, если мы не можем, значит
        // мы стоим в конце параграфа.

        var ContentPos = ( undefined === _ContentPos ? this.Get_ParaContentPos( false, false ) : _ContentPos );
        var SearchPos  = new CParagraphSearchPos();

        this.Get_LeftPos( SearchPos, ContentPos );

        if ( true === SearchPos.Found )
            return false;
        else
            return true;
    },

    // Проверим, начинается ли выделение с начала параграфа
    Selection_IsFromStart : function()
    {
        if ( true === this.Is_SelectionUse() )
        {
            var StartPos = this.Get_ParaContentPos(true, true);
            var EndPos   = this.Get_ParaContentPos(true, false);
            
            if ( StartPos.Compare(EndPos) > 0 )
                StartPos = EndPos;
            
            if ( true != this.Cursor_IsStart( StartPos ) )
                return false;

            return true;
        }

        return false;
    },

    // Очищение форматирования параграфа
    Clear_Formatting : function()
    {
        if(this.bFromDocument)
        {
            this.Style_Remove();
            this.Numbering_Remove();
        }

        this.Set_ContextualSpacing(undefined);
        this.Set_Ind( new CParaInd(), true );
        this.Set_Align( undefined, false );
        this.Set_KeepLines( undefined );
        this.Set_KeepNext( undefined );
        this.Set_PageBreakBefore( undefined );
        this.Set_Spacing( new CParaSpacing(), true );
        this.Set_Shd( new CDocumentShd(), true );
        this.Set_WidowControl( undefined );
        this.Set_Tabs( new CParaTabs() );
        this.Set_Border( undefined, historyitem_Paragraph_Borders_Between );
        this.Set_Border( undefined, historyitem_Paragraph_Borders_Bottom );
        this.Set_Border( undefined, historyitem_Paragraph_Borders_Left );
        this.Set_Border( undefined, historyitem_Paragraph_Borders_Right );
        this.Set_Border( undefined, historyitem_Paragraph_Borders_Top );

        // Надо пересчитать конечный стиль
        this.CompiledPr.NeedRecalc = true;
    },

    Clear_TextFormatting : function()
    {
        var Styles, DefHyper;
        if(this.bFromDocument)
        {
            Styles = this.Parent.Get_Styles();
            DefHyper = Styles.Get_Default_Hyperlink();
        }
        
        // TODO: Сделать, чтобы данная функция работала по выделению
        
        for ( var Index = 0; Index < this.Content.length; Index++ )
        {
            var Item = this.Content[Index];
            Item.Clear_TextFormatting( DefHyper );                        
        }
        
        this.TextPr.Clear_Style();
    },

    Set_Ind : function(Ind, bDeleteUndefined)
    {
        if ( undefined === this.Pr.Ind )
            this.Pr.Ind = new CParaInd();

        if ( ( undefined != Ind.FirstLine || true === bDeleteUndefined ) && this.Pr.Ind.FirstLine !== Ind.FirstLine )
        {
            History.Add( this, { Type : historyitem_Paragraph_Ind_First, New : Ind.FirstLine, Old : ( undefined != this.Pr.Ind.FirstLine ? this.Pr.Ind.FirstLine : undefined ) } );
            this.Pr.Ind.FirstLine = Ind.FirstLine;
        }

        if ( ( undefined != Ind.Left || true === bDeleteUndefined ) && this.Pr.Ind.Left !== Ind.Left )
        {
            History.Add( this, { Type : historyitem_Paragraph_Ind_Left, New : Ind.Left, Old : ( undefined != this.Pr.Ind.Left ? this.Pr.Ind.Left : undefined ) } );
            this.Pr.Ind.Left = Ind.Left;
        }

        if ( ( undefined != Ind.Right || true === bDeleteUndefined ) && this.Pr.Ind.Right !== Ind.Right )
        {
            History.Add( this, { Type : historyitem_Paragraph_Ind_Right, New : Ind.Right, Old : ( undefined != this.Pr.Ind.Right ? this.Pr.Ind.Right : undefined ) } );
            this.Pr.Ind.Right = Ind.Right;
        }

        // Надо пересчитать конечный стиль
        this.CompiledPr.NeedRecalc = true;
    },

    Set_Spacing : function(Spacing, bDeleteUndefined)
    {
        if ( undefined === this.Pr.Spacing )
            this.Pr.Spacing = new CParaSpacing();

        if ( ( undefined != Spacing.Line || true === bDeleteUndefined ) && this.Pr.Spacing.Line !== Spacing.Line )
        {
            History.Add( this, { Type : historyitem_Paragraph_Spacing_Line, New : Spacing.Line, Old : ( undefined != this.Pr.Spacing.Line ? this.Pr.Spacing.Line : undefined ) } );
            this.Pr.Spacing.Line = Spacing.Line;
        }

        if ( ( undefined != Spacing.LineRule || true === bDeleteUndefined ) && this.Pr.Spacing.LineRule !== Spacing.LineRule )
        {
            History.Add( this, { Type : historyitem_Paragraph_Spacing_LineRule, New : Spacing.LineRule, Old : ( undefined != this.Pr.Spacing.LineRule ? this.Pr.Spacing.LineRule : undefined ) } );
            this.Pr.Spacing.LineRule = Spacing.LineRule;
        }

        if ( ( undefined != Spacing.Before || true === bDeleteUndefined ) && this.Pr.Spacing.Before !== Spacing.Before )
        {
            History.Add( this, { Type : historyitem_Paragraph_Spacing_Before, New : Spacing.Before, Old : ( undefined != this.Pr.Spacing.Before ? this.Pr.Spacing.Before : undefined ) } );
            this.Pr.Spacing.Before = Spacing.Before;
        }

        if ( ( undefined != Spacing.After || true === bDeleteUndefined ) && this.Pr.Spacing.After !== Spacing.After )
        {
            History.Add( this, { Type : historyitem_Paragraph_Spacing_After, New : Spacing.After, Old : ( undefined != this.Pr.Spacing.After ? this.Pr.Spacing.After : undefined ) } );
            this.Pr.Spacing.After = Spacing.After;
        }

        if ( ( undefined != Spacing.AfterAutoSpacing || true === bDeleteUndefined ) && this.Pr.Spacing.AfterAutoSpacing !== Spacing.AfterAutoSpacing )
        {
            History.Add( this, { Type : historyitem_Paragraph_Spacing_AfterAutoSpacing, New : Spacing.AfterAutoSpacing, Old : ( undefined != this.Pr.Spacing.AfterAutoSpacing ? this.Pr.Spacing.AfterAutoSpacing : undefined ) } );
            this.Pr.Spacing.AfterAutoSpacing = Spacing.AfterAutoSpacing;
        }

        if ( ( undefined != Spacing.BeforeAutoSpacing || true === bDeleteUndefined ) && this.Pr.Spacing.BeforeAutoSpacing !== Spacing.BeforeAutoSpacing )
        {
            History.Add( this, { Type : historyitem_Paragraph_Spacing_BeforeAutoSpacing, New : Spacing.BeforeAutoSpacing, Old : ( undefined != this.Pr.Spacing.BeforeAutoSpacing ? this.Pr.Spacing.BeforeAutoSpacing : undefined ) } );
            this.Pr.Spacing.BeforeAutoSpacing = Spacing.BeforeAutoSpacing;
        }

        // Надо пересчитать конечный стиль
        this.CompiledPr.NeedRecalc = true;
    },

    Set_Align : function(Align)
    {
        if ( this.Pr.Jc != Align )
        {
            History.Add( this, { Type : historyitem_Paragraph_Align, New : Align, Old : ( undefined != this.Pr.Jc ? this.Pr.Jc : undefined ) } );
            this.Pr.Jc = Align;

            // Надо пересчитать конечный стиль
            this.CompiledPr.NeedRecalc = true;
        }
    },

    Set_Shd : function(_Shd, bDeleteUndefined)
    {
        if ( undefined === _Shd )
        {
            if ( undefined != this.Pr.Shd )
            {
                History.Add( this, { Type : historyitem_Paragraph_Shd, New : undefined, Old : this.Pr.Shd } );
                this.Pr.Shd = undefined;
            }
        }
        else
        {
            var Shd = new CDocumentShd();
            Shd.Set_FromObject( _Shd );

            if ( undefined === this.Pr.Shd )
                this.Pr.Shd = new CDocumentShd();

            if ( ( undefined != Shd.Value || true === bDeleteUndefined ) && this.Pr.Shd.Value !== Shd.Value )
            {
                History.Add( this, { Type : historyitem_Paragraph_Shd_Value, New : Shd.Value, Old : ( undefined != this.Pr.Shd.Value ? this.Pr.Shd.Value : undefined ) } );
                this.Pr.Shd.Value = Shd.Value;
            }

            if ( undefined != Shd.Color || true === bDeleteUndefined )
            {
                History.Add( this, { Type : historyitem_Paragraph_Shd_Color, New : Shd.Color, Old : ( undefined != this.Pr.Shd.Color ? this.Pr.Shd.Color : undefined ) } );
                this.Pr.Shd.Color = Shd.Color;
            }
            if(undefined != Shd.Unifill || true === bDeleteUndefined)
            {
                History.Add( this, { Type : historyitem_Paragraph_Shd_Unifill, New : Shd.Unifill, Old : ( undefined != this.Pr.Shd.Unifill ? this.Pr.Shd.Unifill : undefined ) } );
                this.Pr.Shd.Unifill = Shd.Unifill;
            }
        }

        // Надо пересчитать конечный стиль
        this.CompiledPr.NeedRecalc = true;
    },

    Set_Tabs : function(Tabs)
    {
        var _Tabs = new CParaTabs();

        var StyleTabs = this.Get_CompiledPr2(false).ParaPr.StyleTabs;

        // 1. Ищем табы, которые уже есть в стиле (такие добавлять не надо)
        for ( var Index = 0; Index < Tabs.Tabs.length; Index++ )
        {
            var Value = StyleTabs.Get_Value( Tabs.Tabs[Index].Pos );
            if ( -1 === Value )
                _Tabs.Add( Tabs.Tabs[Index] );
        }

        // 2. Ищем табы в стиле, которые нужно отменить
        for ( var Index = 0; Index < StyleTabs.Tabs.length; Index++ )
        {
            var Value = _Tabs.Get_Value( StyleTabs.Tabs[Index].Pos );
            if ( tab_Clear != StyleTabs.Tabs[Index] && -1 === Value )
                _Tabs.Add( new CParaTab(tab_Clear, StyleTabs.Tabs[Index].Pos ) );
        }

        History.Add( this, { Type : historyitem_Paragraph_Tabs, New : _Tabs, Old : this.Pr.Tabs } );
        this.Pr.Tabs = _Tabs;

        // Надо пересчитать конечный стиль
        this.CompiledPr.NeedRecalc = true;
    },

    Set_ContextualSpacing : function(Value)
    {
        if ( Value != this.Pr.ContextualSpacing )
        {
            History.Add( this, { Type : historyitem_Paragraph_ContextualSpacing, New : Value, Old : ( undefined != this.Pr.ContextualSpacing ? this.Pr.ContextualSpacing : undefined ) } );
            this.Pr.ContextualSpacing = Value;

            // Надо пересчитать конечный стиль
            this.CompiledPr.NeedRecalc = true;
        }
    },

    Set_PageBreakBefore : function(Value)
    {
        if ( Value != this.Pr.PageBreakBefore )
        {
            History.Add( this, { Type : historyitem_Paragraph_PageBreakBefore, New : Value, Old : ( undefined != this.Pr.PageBreakBefore ? this.Pr.PageBreakBefore : undefined ) } );
            this.Pr.PageBreakBefore = Value;

            // Надо пересчитать конечный стиль
            this.CompiledPr.NeedRecalc = true;
        }
    },

    Set_KeepLines : function(Value)
    {
        if ( Value != this.Pr.KeepLines )
        {
            History.Add( this, { Type : historyitem_Paragraph_KeepLines, New : Value, Old : ( undefined != this.Pr.KeepLines ? this.Pr.KeepLines : undefined ) } );
            this.Pr.KeepLines = Value;

            // Надо пересчитать конечный стиль
            this.CompiledPr.NeedRecalc = true;
        }
    },

    Set_KeepNext : function(Value)
    {
        if ( Value != this.Pr.KeepNext )
        {
            History.Add( this, { Type : historyitem_Paragraph_KeepNext, New : Value, Old : ( undefined != this.Pr.KeepNext ? this.Pr.KeepNext : undefined ) } );
            this.Pr.KeepNext = Value;

            // Надо пересчитать конечный стиль
            this.CompiledPr.NeedRecalc = true;
        }
    },

    Set_WidowControl : function(Value)
    {
        if ( Value != this.Pr.WidowControl )
        {
            History.Add( this, { Type : historyitem_Paragraph_WidowControl, New : Value, Old : ( undefined != this.Pr.WidowControl ? this.Pr.WidowControl : undefined ) } );
            this.Pr.WidowControl = Value;

            // Надо пересчитать конечный стиль
            this.CompiledPr.NeedRecalc = true;
        }
    },

    Set_Borders : function(Borders)
    {
        if ( undefined === Borders )
            return;

        var OldBorders = this.Get_CompiledPr2(false).ParaPr.Brd;

        if ( undefined != Borders.Between )
        {
            var NewBorder = undefined;
            if ( undefined != Borders.Between.Value /*&& border_Single === Borders.Between.Value*/ )
            {
                NewBorder = new CDocumentBorder();
                NewBorder.Color = ( undefined != Borders.Between.Color ? new CDocumentColor( Borders.Between.Color.r, Borders.Between.Color.g, Borders.Between.Color.b ) : new CDocumentColor( OldBorders.Between.Color.r, OldBorders.Between.Color.g, OldBorders.Between.Color.b ) );
                NewBorder.Space = ( undefined != Borders.Between.Space ? Borders.Between.Space : OldBorders.Between.Space );
                NewBorder.Size  = ( undefined != Borders.Between.Size  ? Borders.Between.Size  : OldBorders.Between.Size  );
                NewBorder.Value = ( undefined != Borders.Between.Value ? Borders.Between.Value : OldBorders.Between.Value );
                NewBorder.Unifill = ( undefined != Borders.Between.Unifill ? Borders.Between.Unifill.createDuplicate() : OldBorders.Between.Unifill );
            }

            History.Add( this, { Type : historyitem_Paragraph_Borders_Between, New : NewBorder, Old : this.Pr.Brd.Between } );
            this.Pr.Brd.Between = NewBorder;
        }

        if ( undefined != Borders.Top )
        {
            var NewBorder = undefined;
            if ( undefined != Borders.Top.Value /*&& border_Single === Borders.Top.Value*/ )
            {
                NewBorder = new CDocumentBorder();
                NewBorder.Color = ( undefined != Borders.Top.Color ? new CDocumentColor( Borders.Top.Color.r, Borders.Top.Color.g, Borders.Top.Color.b ) : new CDocumentColor( OldBorders.Top.Color.r, OldBorders.Top.Color.g, OldBorders.Top.Color.b ) );
                NewBorder.Space = ( undefined != Borders.Top.Space ? Borders.Top.Space : OldBorders.Top.Space );
                NewBorder.Size  = ( undefined != Borders.Top.Size  ? Borders.Top.Size  : OldBorders.Top.Size  );
                NewBorder.Value = ( undefined != Borders.Top.Value ? Borders.Top.Value : OldBorders.Top.Value );
                NewBorder.Unifill = ( undefined != Borders.Top.Unifill ? Borders.Top.Unifill.createDuplicate() : OldBorders.Top.Unifill );

            }

            History.Add( this, { Type : historyitem_Paragraph_Borders_Top, New : NewBorder, Old : this.Pr.Brd.Top } );
            this.Pr.Brd.Top = NewBorder;
        }

        if ( undefined != Borders.Right )
        {
            var NewBorder = undefined;
            if ( undefined != Borders.Right.Value /*&& border_Single === Borders.Right.Value*/ )
            {
                NewBorder = new CDocumentBorder();
                NewBorder.Color = ( undefined != Borders.Right.Color ? new CDocumentColor( Borders.Right.Color.r, Borders.Right.Color.g, Borders.Right.Color.b ) : new CDocumentColor( OldBorders.Right.Color.r, OldBorders.Right.Color.g, OldBorders.Right.Color.b ) );
                NewBorder.Space = ( undefined != Borders.Right.Space ? Borders.Right.Space : OldBorders.Right.Space );
                NewBorder.Size  = ( undefined != Borders.Right.Size  ? Borders.Right.Size  : OldBorders.Right.Size  );
                NewBorder.Value = ( undefined != Borders.Right.Value ? Borders.Right.Value : OldBorders.Right.Value );
                NewBorder.Unifill = ( undefined != Borders.Right.Unifill ? Borders.Right.Unifill.createDuplicate() : OldBorders.Right.Unifill );

            }

            History.Add( this, { Type : historyitem_Paragraph_Borders_Right, New : NewBorder, Old : this.Pr.Brd.Right } );
            this.Pr.Brd.Right = NewBorder;
        }

        if ( undefined != Borders.Bottom )
        {
            var NewBorder = undefined;
            if ( undefined != Borders.Bottom.Value /*&& border_Single === Borders.Bottom.Value*/ )
            {
                NewBorder = new CDocumentBorder();
                NewBorder.Color = ( undefined != Borders.Bottom.Color ? new CDocumentColor( Borders.Bottom.Color.r, Borders.Bottom.Color.g, Borders.Bottom.Color.b ) : new CDocumentColor( OldBorders.Bottom.Color.r, OldBorders.Bottom.Color.g, OldBorders.Bottom.Color.b ) );
                NewBorder.Space = ( undefined != Borders.Bottom.Space ? Borders.Bottom.Space : OldBorders.Bottom.Space );
                NewBorder.Size  = ( undefined != Borders.Bottom.Size  ? Borders.Bottom.Size  : OldBorders.Bottom.Size  );
                NewBorder.Value = ( undefined != Borders.Bottom.Value ? Borders.Bottom.Value : OldBorders.Bottom.Value );
                NewBorder.Unifill = ( undefined != Borders.Bottom.Unifill ? Borders.Bottom.Unifill.createDuplicate() : OldBorders.Bottom.Unifill );
            }

            History.Add( this, { Type : historyitem_Paragraph_Borders_Bottom, New : NewBorder, Old : this.Pr.Brd.Bottom } );
            this.Pr.Brd.Bottom = NewBorder;
        }

        if ( undefined != Borders.Left  )
        {
            var NewBorder = undefined;
            if ( undefined != Borders.Left.Value /*&& border_Single === Borders.Left.Value*/ )
            {
                NewBorder = new CDocumentBorder();
                NewBorder.Color = ( undefined != Borders.Left.Color ? new CDocumentColor( Borders.Left.Color.r, Borders.Left.Color.g, Borders.Left.Color.b ) : new CDocumentColor( OldBorders.Left.Color.r, OldBorders.Left.Color.g, OldBorders.Left.Color.b ) );
                NewBorder.Space = ( undefined != Borders.Left.Space ? Borders.Left.Space : OldBorders.Left.Space );
                NewBorder.Size  = ( undefined != Borders.Left.Size  ? Borders.Left.Size  : OldBorders.Left.Size  );
                NewBorder.Value = ( undefined != Borders.Left.Value ? Borders.Left.Value : OldBorders.Left.Value );
                NewBorder.Unifill = ( undefined != Borders.Left.Unifill ? Borders.Left.Unifill.createDuplicate() : OldBorders.Left.Unifill );

            }

            History.Add( this, { Type : historyitem_Paragraph_Borders_Left, New : NewBorder, Old : this.Pr.Brd.Left } );
            this.Pr.Brd.Left = NewBorder;
        }

        // Надо пересчитать конечный стиль
        this.CompiledPr.NeedRecalc = true;
    },

    Set_Border : function(Border, HistoryType)
    {
        var OldValue;
        switch( HistoryType )
        {
            case historyitem_Paragraph_Borders_Between: OldValue = this.Pr.Brd.Between; this.Pr.Brd.Between = Border; break;
            case historyitem_Paragraph_Borders_Bottom:  OldValue = this.Pr.Brd.Bottom;  this.Pr.Brd.Bottom  = Border; break;
            case historyitem_Paragraph_Borders_Left:    OldValue = this.Pr.Brd.Left;    this.Pr.Brd.Left    = Border; break;
            case historyitem_Paragraph_Borders_Right:   OldValue = this.Pr.Brd.Right;   this.Pr.Brd.Right   = Border; break;
            case historyitem_Paragraph_Borders_Top:     OldValue = this.Pr.Brd.Top;     this.Pr.Brd.Top     = Border; break;
        }

        History.Add( this, { Type : HistoryType, New : Border, Old : OldValue } );

        // Надо пересчитать конечный стиль
        this.CompiledPr.NeedRecalc = true;
    },

    Set_Bullet : function(Bullet)
    {
        var NewBullet = Bullet ? Bullet.createDuplicate() : null;
        History.Add(this, {Type: historyitem_Paragraph_Bullet, Old: this.Pr.Bullet, New: NewBullet});
        this.Pr.Bullet = NewBullet;
        this.CompiledPr.NeedRecalc = true;
    },

    // Проверяем начинается ли текущий параграф с новой страницы.
    Is_StartFromNewPage : function()
    {
        // TODO: пока здесь стоит простая проверка. В будущем надо будет данную проверку улучшить.
        //       Например, сейчас не учитывается случай, когда в начале параграфа стоит PageBreak.

        if ( ( this.Pages.length > 1 && 0 === this.Pages[1].FirstLine ) || ( 1 === this.Pages.length && -1 === this.Pages[0].EndLine ) || ( null === this.Get_DocumentPrev() ) )
            return true;

        return false;
    },

    // Возвращаем ран в котором лежит данный объект
    Get_DrawingObjectRun : function(Id)
    {
        var Run = null;
        var ContentLen = this.Content.length;
        for ( var Index = 0; Index < ContentLen; Index++ )
        {
            var Element = this.Content[Index];

            Run = Element.Get_DrawingObjectRun(Id);

            if ( null !== Run )
                return Run;
        }

        return Run;
    },

    // Ищем графический объект по Id и удаляем запись он нем в параграфе
    Remove_DrawingObject : function(Id)
    {
        for ( var Index = 0; Index < this.Content.length; Index++ )
        {
            var Item = this.Content[Index];
            if ( para_Drawing === Item.Type && Id === Item.Get_Id() )
            {
                var HdrFtr = this.Parent.Is_HdrFtr(true);
                if ( null != HdrFtr && true != Item.Is_Inline() )
                    HdrFtr.RecalcInfo.NeedRecalc = true;

                this.Internal_Content_Remove( Index );
                return Index;
            }
        }

        return -1;
    },

    Get_DrawingObjectContentPos : function(Id)
    {
        var ContentPos = new CParagraphContentPos();

        var ContentLen = this.Content.length;
        for ( var Index = 0; Index < ContentLen; Index++ )
        {
            var Element = this.Content[Index];

            if ( true === Element.Get_DrawingObjectContentPos(Id, ContentPos, 1) )
            {
                ContentPos.Update2( Index, 0 );
                return ContentPos;
            }
        }

        return null;
    },

    Internal_CorrectAnchorPos : function(Result, Drawing)
    {
        // Поправляем позицию
        var RelH = Drawing.PositionH.RelativeFrom;
        var RelV = Drawing.PositionV.RelativeFrom;

        var ContentPos = 0;

        if ( c_oAscRelativeFromH.Character != RelH || c_oAscRelativeFromV.Line != RelV )
        {
            var CurLine = Result.Internal.Line;
            if ( c_oAscRelativeFromV.Line != RelV )
            {
                var CurPage = Result.Internal.Page;
                CurLine = this.Pages[CurPage].StartLine;
            }

            Result.X = this.Lines[CurLine].Ranges[0].X - 3.8;
        }

        if ( c_oAscRelativeFromV.Line != RelV )
        {
            var CurPage = Result.Internal.Page;
            var CurLine = this.Pages[CurPage].StartLine;
            Result.Y = this.Pages[CurPage].Y + this.Lines[CurLine].Y - this.Lines[CurLine].Metrics.Ascent;
        }

        if ( c_oAscRelativeFromH.Character === RelH  )
        {
            // Ничего не делаем
        }
        else if ( c_oAscRelativeFromV.Line === RelV )
        {
            // Ничего не делаем, пусть ссылка будет в позиции, которая записана в NearPos
        }
        else if ( 0 === Result.Internal.Page )
        {
            // Перемещаем ссылку в начало параграфа
            Result.ContentPos = this.Get_StartPos();
        }
    },

    // Получем ближающую возможную позицию курсора
    Get_NearestPos : function(PageNum, X, Y, bAnchor, Drawing)
    {
        var SearchPosXY = this.Get_ParaContentPosByXY( X, Y, PageNum, false, false );

        this.Set_ParaContentPos( SearchPosXY.Pos, true, SearchPosXY.Line, SearchPosXY.Range );
        var ContentPos = this.Get_ParaContentPos( false, false );

        var Result = this.Internal_Recalculate_CurPos( ContentPos, false, false, true );

        // Сохраняем параграф и найденное место в параграфе
        Result.ContentPos = ContentPos;
        Result.SearchPos  = SearchPosXY.Pos;
        Result.Paragraph  = this;

        if ( true === bAnchor && undefined != Drawing && null != Drawing )
            this.Internal_CorrectAnchorPos( Result, Drawing );

        return Result;
    },

    Check_NearestPos : function(NearPos)
    {
        var ParaNearPos = new CParagraphNearPos();
        ParaNearPos.NearPos = NearPos;

        var Count = this.NearPosArray.length;
        for ( var Index = 0; Index < Count; Index++ )
        {
            if ( this.NearPosArray[Index].NearPos === NearPos )
                return;
        }

        this.NearPosArray.push( ParaNearPos );
        ParaNearPos.Classes.push( this );

        var CurPos = NearPos.ContentPos.Get(0);
        this.Content[CurPos].Check_NearestPos( ParaNearPos, 1 );
    },

    Clear_NearestPosArray : function()
    {
        var ArrayLen = this.NearPosArray.length;

        for (var Pos = 0; Pos < ArrayLen; Pos++)
        {
            var ParaNearPos = this.NearPosArray[Pos];

            var ArrayLen2 = ParaNearPos.Classes.length;

            // 0 элемент это сам класс Paragraph, массив в нем очищаем в данной функции в конце
            for ( var Pos2 = 1; Pos2 < ArrayLen2; Pos2++ )
            {
                var Class = ParaNearPos.Classes[Pos2];
                Class.NearPosArray = [];
            }
        }

        this.NearPosArray = [];
    },

    Get_ParaNearestPos : function(NearPos)
    {
        var ArrayLen = this.NearPosArray.length;

        for (var Pos = 0; Pos < ArrayLen; Pos++)
        {
            var ParaNearPos = this.NearPosArray[Pos];

            if ( NearPos === ParaNearPos.NearPos )
                return ParaNearPos;
        }

        return null;
    },

    Get_Layout : function(ContentPos, Drawing)
    {
        var LinePos = this.Get_ParaPosByContentPos( ContentPos );

        var CurLine  = LinePos.Line;
        var CurRange = LinePos.Range;
        var CurPage  = LinePos.Page;

        var X = this.Lines[CurLine].Ranges[CurRange].XVisible;
        var Y = this.Pages[CurPage].Y + this.Lines[CurLine].Y;

        if ( true === this.Numbering.Check_Range(CurRange, CurLine) )
            X += this.Numbering.WidthVisible;

        var DrawingLayout = new CParagraphDrawingLayout(Drawing, this, X, Y, CurLine, CurRange, CurPage);

        var StartPos = this.Lines[CurLine].Ranges[CurRange].StartPos;
        var EndPos   = this.Lines[CurLine].Ranges[CurRange].EndPos;

        var CurContentPos = ContentPos.Get(0);

        for ( var CurPos = StartPos; CurPos <= EndPos; CurPos++ )
        {
            this.Content[CurPos].Get_Layout(DrawingLayout, ( CurPos === CurContentPos ? true : false ), ContentPos, 1);

            if ( null !== DrawingLayout.Layout )
                return { ParagraphLayout : DrawingLayout.Layout, PageLimits : DrawingLayout.Limits };
        }

        return undefined;
    },

    Get_AnchorPos : function(Drawing)
    {
        var ContentPos = this.Get_DrawingObjectContentPos( Drawing.Get_Id() );

        if ( null === ContentPos )
            return { X : 0, Y : 0, Height : 0 };

        var ParaPos = this.Get_ParaPosByContentPos( ContentPos );

        // Можем не бояться изменить положение курсора, т.к. данная функция работает, только когда у нас идет
        // выделение автофигуры, а значит курсора нет на экране.

        this.Set_ParaContentPos( ContentPos, false, -1, -1 );

        var Result = this.Internal_Recalculate_CurPos( ContentPos, false, false, true );

        Result.Paragraph  = this;
        Result.ContentPos = ContentPos;

        this.Internal_CorrectAnchorPos( Result, Drawing );

        return Result;
    },

    Set_DocumentNext : function(Object)
    {
        History.Add( this, { Type : historyitem_Paragraph_DocNext, New : Object, Old : this.Next } );
        this.Next = Object;
    },

    Set_DocumentPrev : function(Object)
    {
        History.Add( this, { Type : historyitem_Paragraph_DocPrev, New : Object, Old : this.Prev } );
        this.Prev = Object;
    },

    Get_DocumentNext : function()
    {
        return this.Next;
    },

    Get_DocumentPrev : function()
    {
        return this.Prev;
    },

    Set_DocumentIndex : function(Index)
    {
        this.Index = Index;
    },

    Set_Parent : function(ParentObject)
    {
        History.Add( this, { Type : historyitem_Paragraph_Parent, New : ParentObject, Old : this.Parent } );
        this.Parent = ParentObject;
    },

    Get_Parent : function()
    {
        return this.Parent;
    },

    Is_ContentOnFirstPage : function()
    {
        // Если параграф сразу переносится на новую страницу, тогда это значение обычно -1
        if ( this.Pages[0].EndLine < 0 )
            return false;

        return true;
    },

    Get_CurrentPage_Absolute : function()
    {
        // Обновляем позицию
        this.Internal_Recalculate_CurPos( this.CurPos.ContentPos, true, false, false );
        return (this.Get_StartPage_Absolute() + this.CurPos.PagesPos);
    },

    Get_CurrentPage_Relative : function()
    {
        // Обновляем позицию
        this.Internal_Recalculate_CurPos( this.CurPos.ContentPos, true, false, false );
        return (this.PageNum + this.CurPos.PagesPos);
    },

    DocumentStatistics : function(Stats)
    {
        var ParaStats = new CParagraphStatistics(Stats);
        var Count = this.Content.length;

        for ( var Index = 0; Index < Count; Index++ )
        {
            var Item = this.Content[Index];
            Item.Collect_DocumentStatistics( ParaStats );
        }

        var NumPr = this.Numbering_Get();
        if ( undefined != NumPr )
        {
            ParaStats.EmptyParagraph = false;
            this.Parent.Get_Numbering().Get_AbstractNum( NumPr.NumId).DocumentStatistics( NumPr.Lvl, Stats );
        }

        if ( false === ParaStats.EmptyParagraph )
            Stats.Add_Paragraph();
    },

    TurnOff_RecalcEvent : function()
    {
        this.TurnOffRecalcEvent = true;
    },

    TurnOn_RecalcEvent : function()
    {
        this.TurnOffRecalcEvent = false;
    },

    Set_ApplyToAll : function(bValue)
    {
        this.ApplyToAll = bValue;
    },

    Get_ApplyToAll : function()
    {
        return this.ApplyToAll;
    },

    Get_ParentTextTransform : function()
    {
        var CurDocContent = this.Parent;
        while(CurDocContent.Is_TableCellContent())
        {
            CurDocContent = CurDocContent.Parent.Row.Table.Parent;
        }
        if(CurDocContent.Parent && CurDocContent.Parent.transformText)
        {
            return CurDocContent.Parent.transformText;
        }
        return null;
    },

    Update_CursorType : function(X, Y, PageIndex)
    {
        var text_transform = this.Get_ParentTextTransform();
        var MMData = new CMouseMoveData();
        var Coords = this.DrawingDocument.ConvertCoordsToCursorWR( X, Y, this.Get_StartPage_Absolute() + ( PageIndex - this.PageNum ), text_transform );
        MMData.X_abs = Coords.X;
        MMData.Y_abs = Coords.Y;

        var Hyperlink = this.Check_Hyperlink( X, Y, PageIndex );

        var PNum = PageIndex - this.PageNum;
        if ( null != Hyperlink && ( PNum >= 0 && PNum < this.Pages.length && Y <= this.Pages[PNum].Bounds.Bottom && Y >= this.Pages[PNum].Bounds.Top ) )
        {
            MMData.Type      = c_oAscMouseMoveDataTypes.Hyperlink;
            MMData.Hyperlink = new CHyperlinkProperty( Hyperlink );
        }
        else
            MMData.Type      = c_oAscMouseMoveDataTypes.Common;

        if ( null != Hyperlink && true === global_keyboardEvent.CtrlKey )
            this.DrawingDocument.SetCursorType( "pointer", MMData );
        else
            this.DrawingDocument.SetCursorType( "default", MMData );

        var PNum = Math.max( 0, Math.min( PageIndex - this.PageNum, this.Pages.length - 1 ) );
        var Bounds = this.Pages[PNum].Bounds;
        if ( true === this.Lock.Is_Locked() && X < Bounds.Right && X > Bounds.Left && Y > Bounds.Top && Y < Bounds.Bottom )
        {
            var _X = this.Pages[PNum].X;
            var _Y = this.Pages[PNum].Y;

            var MMData = new CMouseMoveData();
            var Coords = this.DrawingDocument.ConvertCoordsToCursorWR( _X, _Y, this.Get_StartPage_Absolute() + ( PageIndex - this.PageNum ), text_transform );
            MMData.X_abs            = Coords.X - 5;
            MMData.Y_abs            = Coords.Y;
            MMData.Type             = c_oAscMouseMoveDataTypes.LockedObject;
            MMData.UserId           = this.Lock.Get_UserId();
            MMData.HaveChanges      = this.Lock.Have_Changes();
            MMData.LockedObjectType = c_oAscMouseMoveLockedObjectType.Common;

            editor.sync_MouseMoveCallback( MMData );
        }
    },

    Document_CreateFontMap : function(FontMap)
    {
        if ( true === this.FontMap.NeedRecalc )
        {
            this.FontMap.Map = {};

            this.Internal_CompileParaPr();

            var FontScheme = this.Get_Theme().themeElements.fontScheme;
            var CurTextPr = this.CompiledPr.Pr.TextPr.Copy();

            CurTextPr.Document_CreateFontMap( this.FontMap.Map, FontScheme );

            CurTextPr.Merge( this.TextPr.Value );
            CurTextPr.Document_CreateFontMap( this.FontMap.Map, FontScheme );

            var Count = this.Content.length;
            for ( var Index = 0; Index < Count; Index++ )
            {
                this.Content[Index].Create_FontMap( this.FontMap.Map );
            }

            this.FontMap.NeedRecalc = false;
        }

        for ( var Key in this.FontMap.Map )
        {
            FontMap[Key] = this.FontMap.Map[Key];
        }
    },

    Document_CreateFontCharMap : function(FontCharMap)
    {
        this.Internal_CompileParaPr();

        var CurTextPr = this.CompiledPr.Pr.TextPr.Copy();
        FontCharMap.StartFont( CurTextPr.FontFamily.Name, CurTextPr.Bold, CurTextPr.Italic, CurTextPr.FontSize );

        for ( var Index = 0; Index < this.Content.length; Index++ )
        {
            var Item = this.Content[Index];

            if ( para_TextPr === Item.Type )
            {
                // Выставляем начальные настройки текста у данного параграфа
                CurTextPr = this.CompiledPr.Pr.TextPr.Copy();

                var _CurTextPr = Item.Value;

                // Копируем настройки из символьного стиля
                if ( undefined != _CurTextPr.RStyle )
                {
                    var Styles = this.Parent.Get_Styles();
                    var StyleTextPr = Styles.Get_Pr( _CurTextPr.RStyle, styletype_Character).TextPr;
                    CurTextPr.Merge( StyleTextPr );
                }

                // Копируем прямые настройки
                CurTextPr.Merge( _CurTextPr );
                FontCharMap.StartFont( CurTextPr.FontFamily.Name, CurTextPr.Bold, CurTextPr.Italic, CurTextPr.FontSize );
            }
            else if ( para_Text === Item.Type )
            {
                FontCharMap.AddChar( Item.Value );
            }
            else if ( para_Space === Item.Type )
            {
                FontCharMap.AddChar( ' ' );
            }
            else if ( para_Numbering === Item.Type )
            {
                var ParaPr = this.CompiledPr.Pr.ParaPr;
                var NumPr = ParaPr.NumPr;
                if ( undefined === NumPr || undefined === NumPr.NumId || 0 === NumPr.NumId || "0" === NumPr.NumId )
                    continue;

                var Numbering = this.Parent.Get_Numbering();
                var NumInfo   = this.Parent.Internal_GetNumInfo( this.Id, NumPr );
                var NumTextPr = this.CompiledPr.Pr.TextPr.Copy();
                NumTextPr.Merge( this.TextPr.Value );
                NumTextPr.Merge( NumLvl.TextPr );

                Numbering.Document_CreateFontCharMap( FontCharMap, NumTextPr, NumPr, NumInfo );
                FontCharMap.StartFont( CurTextPr.FontFamily.Name, CurTextPr.Bold, CurTextPr.Italic, CurTextPr.FontSize );
            }
            else if ( para_PageNum === Item.Type )
            {
                Item.Document_CreateFontCharMap( FontCharMap );
            }
        }

        CurTextPr.Merge( this.TextPr.Value );
    },

    Document_Get_AllFontNames : function(AllFonts)
    {
        // Смотрим на знак конца параграфа
        this.TextPr.Value.Document_Get_AllFontNames( AllFonts );

        var Count = this.Content.length;
        for ( var Index = 0; Index < Count; Index++ )
        {
            this.Content[Index].Get_AllFontNames( AllFonts );
        }
    },

    // Обновляем линейку
    Document_UpdateRulersState : function()
    {
        if ( true === this.Is_Inline() )
        {
            this.LogicDocument.Document_UpdateRulersStateBySection();
        }
        else
        {
            var Frame = this.CalculatedFrame;
            this.Parent.DrawingDocument.Set_RulerState_Paragraph( { L : Frame.L, T : Frame.T, R : Frame.L + Frame.W, B : Frame.T + Frame.H, PageIndex : Frame.PageIndex, Frame : this }, false );
        }
    },

    // Пока мы здесь проверяем только, находимся ли мы внутри гиперссылки
    Document_UpdateInterfaceState : function()
    {
        var StartPos, EndPos;
        if ( true === this.Selection.Use )
        {
            StartPos = this.Get_ParaContentPos( true, true );
            EndPos = this.Get_ParaContentPos( true, false );
        }
        else
        {
            var CurPos = this.Get_ParaContentPos( false, false );
            StartPos = CurPos;
            EndPos   = CurPos;
        }

        if ( this.bFromDocument && this.LogicDocument && true === this.LogicDocument.Spelling.Use )
            this.SpellChecker.Document_UpdateInterfaceState( StartPos, EndPos );

        var HyperPos = -1;
        var Math     = null;

        if ( true === this.Selection.Use )
        {
            var StartPos = this.Selection.StartPos;
            var EndPos   = this.Selection.EndPos;
            if ( StartPos > EndPos )
            {
                StartPos = this.Selection.EndPos;
                EndPos   = this.Selection.StartPos;
            }

            for ( var CurPos = StartPos; CurPos <= EndPos; CurPos++ )
            {
                var Element = this.Content[CurPos];

                if ( true !== Element.Selection_IsEmpty() && para_Hyperlink !== Element.Type )
                    break;
                else if ( true !== Element.Selection_IsEmpty() && para_Hyperlink === Element.Type )
                {
                    if ( -1 === HyperPos )
                        HyperPos = CurPos;
                    else
                        break;
                }
            }

            if ( this.Selection.StartPos === this.Selection.EndPos && para_Hyperlink === this.Content[this.Selection.StartPos].Type )
                HyperPos = this.Selection.StartPos;
            
            if (this.Selection.StartPos === this.Selection.EndPos && para_Math === this.Content[this.Selection.EndPos].Type )
                Math = this.Content[this.Selection.EndPos];
        }
        else
        {
            if (para_Hyperlink === this.Content[this.CurPos.ContentPos].Type)
                HyperPos = this.CurPos.ContentPos;
            else if (para_Math === this.Content[this.CurPos.ContentPos].Type)
                Math = this.Content[this.CurPos.ContentPos];
        }

        if ( -1 !== HyperPos )
        {
            var Hyperlink = this.Content[HyperPos];

            var HyperText = new CParagraphGetText();
            Hyperlink.Get_Text( HyperText );

            var HyperProps = new CHyperlinkProperty( Hyperlink );
            HyperProps.put_Text( HyperText.Text );

            editor.sync_HyperlinkPropCallback( HyperProps );
        }
        
        if ( null !== Math )
        {
            var PixelError = editor.WordControl.m_oLogicDocument.DrawingDocument.GetMMPerDot(1) * 3;
            this.Parent.DrawingDocument.Update_MathTrack(true, Math.X - PixelError, Math.Y - PixelError, Math.Width + 2 * PixelError, Math.Height + 2 * PixelError, this.CurPos.PagesPos + this.Get_StartPage_Absolute());
        }
        else
            this.Parent.DrawingDocument.Update_MathTrack(false);
    },

    // Функция, которую нужно вызвать перед удалением данного элемента
    PreDelete : function()
    {
        // Поскольку данный элемент удаляется, поэтому надо удалить все записи о
        // inline объектах в родительском классе, используемых в данном параграфе.
        // Кроме этого, если тут начинались или заканчивались комметарии, то их тоже
        // удаляем.

        for ( var Index = 0; Index < this.Content.length; Index++ )
        {
            var Item = this.Content[Index];
            if ( para_Comment === Item.Type )
            {
                this.LogicDocument.Remove_Comment( Item.CommentId, true, false );
            }
        }
    },
//-----------------------------------------------------------------------------------
// Функции для работы с номерами страниц
//-----------------------------------------------------------------------------------
    Get_StartPage_Absolute : function()
    {
        return this.Parent.Get_StartPage_Absolute() + this.Get_StartPage_Relative();
    },

    Get_StartPage_Relative : function()
    {
        return this.PageNum;
    },
//-----------------------------------------------------------------------------------
// Дополнительные функции
//-----------------------------------------------------------------------------------
    Document_SetThisElementCurrent : function(bUpdateStates)
    {
        this.Parent.Set_CurrentElement( this.Index, bUpdateStates );
    },

    Is_ThisElementCurrent : function()
    {
        var Parent = this.Parent;

        if ( docpostype_Content === Parent.CurPos.Type && false === Parent.Selection.Use && this.Index === Parent.CurPos.ContentPos && Parent.Content[this.Index] === this )
            return this.Parent.Is_ThisElementCurrent();

        return false;
    },

    Is_Inline : function()
    {
        if ( undefined != this.Pr.FramePr && c_oAscYAlign.Inline !== this.Pr.FramePr.YAlign )
            return false;

        return true;
    },

    Get_FramePr : function()
    {
        return this.Pr.FramePr;
    },

    Set_FramePr : function(FramePr, bDelete)
    {
        var FramePr_old = this.Pr.FramePr;
        if ( undefined === bDelete )
            bDelete = false;

        if ( true === bDelete )
        {
            this.Pr.FramePr = undefined;
            History.Add( this, { Type : historyitem_Paragraph_FramePr, Old : FramePr_old, New : undefined } );
            this.CompiledPr.NeedRecalc = true;
            return;
        }

        var FrameParas = this.Internal_Get_FrameParagraphs();

        // Тут FramePr- объект класса из api.js CParagraphFrame
        if ( true === FramePr.FromDropCapMenu && 1 === FrameParas.length )
        {
            // Здесь мы смотрим только на количество строк, шрифт, тип и горизонтальный отступ от текста
            var NewFramePr = FramePr_old.Copy();

            if ( undefined != FramePr.DropCap )
            {
                var OldLines = NewFramePr.Lines;
                NewFramePr.Init_Default_DropCap( FramePr.DropCap === c_oAscDropCap.Drop ? true : false );
                NewFramePr.Lines = OldLines;
            }

            if ( undefined != FramePr.Lines )
            {
                var AnchorPara = this.Get_FrameAnchorPara();

                if ( null === AnchorPara || AnchorPara.Lines.length <= 0 )
                    return;

                var Before = AnchorPara.Get_CompiledPr().ParaPr.Spacing.Before;
                var LineH  = AnchorPara.Lines[0].Bottom - AnchorPara.Lines[0].Top - Before;
                var LineTA = AnchorPara.Lines[0].Metrics.TextAscent2;
                var LineTD = AnchorPara.Lines[0].Metrics.TextDescent + AnchorPara.Lines[0].Metrics.LineGap;

                this.Set_Spacing( { LineRule : linerule_Exact, Line : FramePr.Lines * LineH }, false );
                this.Update_DropCapByLines( this.Internal_CalculateTextPr( this.Internal_GetStartPos() ), FramePr.Lines, LineH, LineTA, LineTD, Before );
                
                NewFramePr.Lines = FramePr.Lines;
            }

            if ( undefined != FramePr.FontFamily )
            {
                var FF = new ParaTextPr( { RFonts : { Ascii : { Name : FramePr.FontFamily.Name, Index : -1 } }  } );
                this.Select_All();
                this.Add( FF );
                this.Selection_Remove();
            }

            if ( undefined != FramePr.HSpace )
                NewFramePr.HSpace = FramePr.HSpace;

            this.Pr.FramePr = NewFramePr;
        }
        else
        {
            var NewFramePr = FramePr_old.Copy();

            if ( undefined != FramePr.H )
                NewFramePr.H = FramePr.H;

            if ( undefined != FramePr.HAnchor )
                NewFramePr.HAnchor = FramePr.HAnchor;

            if ( undefined != FramePr.HRule )
                NewFramePr.HRule = FramePr.HRule;

            if ( undefined != FramePr.HSpace )
                NewFramePr.HSpace = FramePr.HSpace;

            if ( undefined != FramePr.Lines )
                NewFramePr.Lines = FramePr.Lines;

            if ( undefined != FramePr.VAnchor )
                NewFramePr.VAnchor = FramePr.VAnchor;

            if ( undefined != FramePr.VSpace )
                NewFramePr.VSpace = FramePr.VSpace;

            // Потому что undefined - нормальное значение (и W всегда заполняется в интерфейсе)
            NewFramePr.W = FramePr.W;

            if ( undefined != FramePr.X )
            {
                NewFramePr.X      = FramePr.X;
                NewFramePr.XAlign = undefined;
            }

            if ( undefined != FramePr.XAlign )
            {
                NewFramePr.XAlign = FramePr.XAlign;
                NewFramePr.X      = undefined;
            }

            if ( undefined != FramePr.Y )
            {
                NewFramePr.Y      = FramePr.Y;
                NewFramePr.YAlign = undefined;
            }

            if ( undefined != FramePr.YAlign )
            {
                NewFramePr.YAlign = FramePr.YAlign;
                NewFramePr.Y      = undefined;
            }
            
            if ( undefined !== FramePr.Wrap )
            {
                if ( false === FramePr.Wrap )
                    NewFramePr.Wrap = wrap_NotBeside;
                else if ( true === FramePr.Wrap )
                    NewFramePr.Wrap = wrap_Around;
                else
                    NewFramePr.Wrap = FramePr.Wrap;
            }

            this.Pr.FramePr = NewFramePr;
        }

        if ( undefined != FramePr.Brd )
        {
            var Count = FrameParas.length;
            for ( var Index = 0; Index < Count; Index++ )
            {
                FrameParas[Index].Set_Borders( FramePr.Brd );
            }
        }

        if ( undefined != FramePr.Shd )
        {
            var Count = FrameParas.length;
            for ( var Index = 0; Index < Count; Index++ )
            {
                FrameParas[Index].Set_Shd( FramePr.Shd );
            }
        }

        History.Add( this, { Type : historyitem_Paragraph_FramePr, Old : FramePr_old, New : this.Pr.FramePr } );
        this.CompiledPr.NeedRecalc = true;
    },

    Set_FramePr2 : function(FramePr)
    {
        History.Add( this, { Type : historyitem_Paragraph_FramePr, Old : this.Pr.FramePr, New : FramePr } );
        this.Pr.FramePr = FramePr;
        this.CompiledPr.NeedRecalc = true;
    },

    Set_FrameParaPr : function(Para)
    {
        Para.CopyPr( this );        
        Para.Set_Ind( { FirstLine : 0 }, false );
        this.Set_Spacing( { After : 0 }, false );
        this.Set_Ind( { Right : 0 }, false );
        this.Numbering_Remove();        
    },

    Get_FrameBounds : function(FrameX, FrameY, FrameW, FrameH)
    {
        var X0 = FrameX, Y0 = FrameY, X1 = FrameX + FrameW, Y1 = FrameY + FrameH;

        var Paras = this.Internal_Get_FrameParagraphs();
        var Count = Paras.length;
        var FramePr = this.Get_FramePr();

        if ( 0 >= Count )
            return { X : X0, Y : Y0, W : X1 - X0, H : Y1 - Y0 };

        for ( var Index = 0; Index < Count; Index++ )
        {
            var Para   = Paras[Index];
            var ParaPr = Para.Get_CompiledPr2(false).ParaPr;
            var Brd    = ParaPr.Brd;

            var _X0 = X0 + ParaPr.Ind.Left + ParaPr.Ind.FirstLine;

            if ( undefined != Brd.Left && border_None != Brd.Left.Value )
                _X0 -= Brd.Left.Size + Brd.Left.Space + 1;

            if ( _X0 < X0 )
                X0 = _X0

            var _X1 = X1 - ParaPr.Ind.Right;

            if ( undefined != Brd.Right && border_None != Brd.Right.Value )
                _X1 += Brd.Right.Size + Brd.Right.Space + 1;

            if ( _X1 > X1 )
                X1 = _X1;
        }

        var _Y1 = Y1;
        var BottomBorder = Paras[Count - 1].Get_CompiledPr2(false).ParaPr.Brd.Bottom;
        if ( undefined != BottomBorder && border_None != BottomBorder.Value )
            _Y1 += BottomBorder.Size + BottomBorder.Space;

        if ( _Y1 > Y1 && ( heightrule_Auto === FramePr.HRule || ( heightrule_AtLeast === FramePr.HRule && FrameH >= FramePr.H ) ) )
            Y1 = _Y1;

        return { X : X0, Y : Y0, W : X1 - X0, H : Y1 - Y0 };
    },

    Set_CalculatedFrame : function(L, T, W, H, L2, T2, W2, H2, PageIndex)
    {
        this.CalculatedFrame.T = T;
        this.CalculatedFrame.L = L;
        this.CalculatedFrame.W = W;
        this.CalculatedFrame.H = H;
        this.CalculatedFrame.T2 = T2;
        this.CalculatedFrame.L2 = L2;
        this.CalculatedFrame.W2 = W2;
        this.CalculatedFrame.H2 = H2;
        this.CalculatedFrame.PageIndex = PageIndex;
    },

    Get_CalculatedFrame : function()
    {
        return this.CalculatedFrame;
    },

    Internal_Get_FrameParagraphs : function()
    {
        var FrameParas = [];

        var FramePr = this.Get_FramePr();
        if ( undefined === FramePr )
            return FrameParas;

        FrameParas.push( this );

        var Prev = this.Get_DocumentPrev();
        while ( null != Prev )
        {
            if ( type_Paragraph === Prev.GetType() )
            {
                var PrevFramePr = Prev.Get_FramePr();
                if ( undefined != PrevFramePr && true === FramePr.Compare( PrevFramePr ) )
                {
                    FrameParas.push(  Prev );
                    Prev = Prev.Get_DocumentPrev();
                }
                else
                    break;
            }
            else
                break;
        }

        var Next = this.Get_DocumentNext();
        while ( null != Next )
        {
            if ( type_Paragraph === Next.GetType() )
            {
                var NextFramePr = Next.Get_FramePr();
                if ( undefined != NextFramePr && true === FramePr.Compare( NextFramePr ) )
                {
                    FrameParas.push(  Next );
                    Next = Next.Get_DocumentNext();
                }
                else
                    break;
            }
            else
                break;
        }

        return FrameParas;
    },

    Is_LineDropCap : function()
    {
        var FrameParas = this.Internal_Get_FrameParagraphs();
        if ( 1 !== FrameParas.length || 1 !== this.Lines.length )
            return false;

        return true;
    },

    Get_LineDropCapWidth : function()
    {
        var W = this.Lines[0].Ranges[0].W;
        var ParaPr = this.Get_CompiledPr2(false).ParaPr;
        W += ParaPr.Ind.Left + ParaPr.Ind.FirstLine;

        return W;
    },

    Change_Frame : function(X, Y, W, H, PageIndex)
    {
        var LogicDocument = editor.WordControl.m_oLogicDocument;

        var FramePr = this.Get_FramePr();
        if ( undefined === FramePr || ( Math.abs( Y - this.CalculatedFrame.T ) < 0.001 && Math.abs( X - this.CalculatedFrame.L ) < 0.001 && Math.abs( W - this.CalculatedFrame.W ) < 0.001 && Math.abs( H - this.CalculatedFrame.H ) < 0.001 && PageIndex === this.CalculatedFrame.PageIndex ) )
            return;

        var FrameParas = this.Internal_Get_FrameParagraphs();
        if ( false === LogicDocument.Document_Is_SelectionLocked( changestype_None, { Type : changestype_2_ElementsArray_and_Type, Elements : FrameParas, CheckType : changestype_Paragraph_Content } ) )
        {
            History.Create_NewPoint();
            var NewFramePr = FramePr.Copy();

            if ( Math.abs( X - this.CalculatedFrame.L ) > 0.001 )
            {
                NewFramePr.X       = X;
                NewFramePr.XAlign  = undefined;
                NewFramePr.HAnchor = c_oAscHAnchor.Page;
            }

            if ( Math.abs( Y - this.CalculatedFrame.T ) > 0.001 )
            {
                NewFramePr.Y       = Y;
                NewFramePr.YAlign  = undefined;
                NewFramePr.VAnchor = c_oAscVAnchor.Page;
            }

            if ( Math.abs( W - this.CalculatedFrame.W ) > 0.001 )
                NewFramePr.W = W;

            if ( Math.abs( H - this.CalculatedFrame.H ) > 0.001 )
            {
                if ( undefined != FramePr.DropCap && dropcap_None != FramePr.DropCap && 1 === FrameParas.length )
                {
                    var PageH = this.LogicDocument.Get_PageLimits( PageIndex).YLimit;
                    var _H = Math.min( H, PageH );
                    NewFramePr.Lines = this.Update_DropCapByHeight( _H );
                    NewFramePr.HRule = linerule_Auto;
                }
                else
                {
                    if ( H <= this.CalculatedFrame.H )
                        NewFramePr.HRule = linerule_Exact;
                    else
                        NewFramePr.HRule = linerule_AtLeast;

                    NewFramePr.H = H;
                }
            }

            var Count = FrameParas.length;
            for ( var Index = 0; Index < Count; Index++ )
            {
                var Para = FrameParas[Index];
                Para.Set_FramePr( NewFramePr, false );
            }

            LogicDocument.Recalculate();
            LogicDocument.Document_UpdateInterfaceState();
        }
    },

    Supplement_FramePr : function(FramePr)
    {
        if ( undefined != FramePr.DropCap && dropcap_None != FramePr.DropCap )
        {
            var _FramePr = this.Get_FramePr();
            var FirstFramePara = this;
            var Prev = FirstFramePara.Get_DocumentPrev();
            while ( null != Prev )
            {
                if ( type_Paragraph === Prev.GetType() )
                {
                    var PrevFramePr = Prev.Get_FramePr();
                    if ( undefined != PrevFramePr && true === _FramePr.Compare( PrevFramePr ) )
                    {
                        FirstFramePara = Prev;
                        Prev = Prev.Get_DocumentPrev();
                    }
                    else
                        break;
                }
                else
                    break;
            }

            var TextPr = FirstFramePara.Get_FirstRunPr();

            if (undefined === TextPr.RFonts || undefined === TextPr.RFonts.Ascii)
            {
                TextPr = this.Get_CompiledPr2(false).TextPr;
            }
            
            FramePr.FontFamily =
            {
                Name  : TextPr.RFonts.Ascii.Name,
                Index : TextPr.RFonts.Ascii.Index
            };
        }

        var FrameParas = this.Internal_Get_FrameParagraphs();
        var Count = FrameParas.length;

        var ParaPr = FrameParas[0].Get_CompiledPr2(false).ParaPr.Copy();
        for ( var Index = 1; Index < Count; Index++ )
        {
            var TempPr= FrameParas[Index].Get_CompiledPr2(false).ParaPr;
            ParaPr = ParaPr.Compare(TempPr);
        }

        FramePr.Brd = ParaPr.Brd;
        FramePr.Shd = ParaPr.Shd;
    },

    Can_AddDropCap : function()
    {
        var Count = this.Content.length;
        for ( var Pos = 0; Pos < Count; Pos++ )
        {
            var TempRes = this.Content[Pos].Can_AddDropCap();
            
            if ( null !== TempRes )
                return TempRes;
        }

        return false;
    },
    
    Get_TextForDropCap : function(DropCapText, UseContentPos, ContentPos, Depth)
    {
        var EndPos = ( true === UseContentPos ? ContentPos.Get(Depth) : this.Content.length - 1 );

        for ( var Pos = 0; Pos <= EndPos; Pos++ )
        {
            this.Content[Pos].Get_TextForDropCap( DropCapText, (true === UseContentPos && Pos === EndPos ? true : false), ContentPos, Depth + 1 );
            
            if ( true === DropCapText.Mixed && ( true === DropCapText.Check || DropCapText.Runs.length > 0 ) )
                return;
        }
    },

    Split_DropCap : function(NewParagraph)
    {
        // Если есть выделение, тогда мы проверяем элементы, идущие до конца выделения, если есть что-то кроме текста
        // тогда мы добавляем в буквицу только первый текстовый элемент, иначе добавляем все от начала параграфа и до
        // конца выделения, кроме этого в буквицу добавляем все табы идущие в начале.

        var DropCapText = new CParagraphGetDropCapText();     
        if ( true == this.Selection.Use && 0 === this.Parent.Selection_Is_OneElement() )
        {
            var SelSP = this.Get_ParaContentPos( true, true );
            var SelEP = this.Get_ParaContentPos( true, false );
            
            if ( 0 <= SelSP.Compare( SelEP ) )
                SelEP = SelSP;

            DropCapText.Check = true;
            this.Get_TextForDropCap( DropCapText, true, SelEP, 0 );
            
            DropCapText.Check = false;
            this.Get_TextForDropCap( DropCapText, true, SelEP, 0 );
        }
        else
        {
            DropCapText.Mixed = true;
            DropCapText.Check = false;
            this.Get_TextForDropCap( DropCapText, false );
        }
        
        var Count = DropCapText.Text.length;
        var PrevRun = null;
        var CurrRun = null;
        
        for ( var Pos = 0, ParaPos = 0, RunPos = 0; Pos < Count; Pos++ )
        {
            if ( PrevRun !== DropCapText.Runs[Pos] )
            {
                PrevRun = DropCapText.Runs[Pos];
                CurrRun = new ParaRun(NewParagraph);
                CurrRun.Set_Pr( DropCapText.Runs[Pos].Pr.Copy() );
                
                NewParagraph.Internal_Content_Add( ParaPos++, CurrRun, false );
                
                RunPos = 0;
            }
            
            CurrRun.Add_ToContent( RunPos++, DropCapText.Text[Pos], false );
        }
        
        if ( Count > 0 )
            return DropCapText.Runs[Count - 1].Get_CompiledPr(true);
        
        return null;
    },

    Update_DropCapByLines : function(TextPr, Count, LineH, LineTA, LineTD, Before)
    {
        if ( null === TextPr )
            return;
        
        // Мы должны сделать так, чтобы высота данного параграфа была точно Count * LineH
        this.Set_Spacing( { Before : Before, After : 0, LineRule : linerule_Exact, Line : Count * LineH - 0.001 }, false );

        var FontSize = 72;
        TextPr.FontSize = FontSize;

        g_oTextMeasurer.SetTextPr(TextPr, this.Get_Theme());
        g_oTextMeasurer.SetFontSlot(fontslot_ASCII, 1);

        var TMetrics = { Ascent : null, Descent : null };

        var TempCount = this.Content.length;
        for ( var Index = 0; Index < TempCount; Index++ )
        {
            this.Content[Index].Recalculate_Measure2( TMetrics );
        }
        
        var TDescent = TMetrics.Descent;
        var TAscent  = TMetrics.Ascent;

        var THeight = 0;
        if ( null === TAscent || null === TDescent )
            THeight = g_oTextMeasurer.GetHeight();
        else
            THeight = -TDescent + TAscent;

        var EmHeight = THeight;

        var NewEmHeight = (Count - 1) * LineH + LineTA;
        var Koef = NewEmHeight / EmHeight;

        var NewFontSize = TextPr.FontSize * Koef;
        TextPr.FontSize = parseInt(NewFontSize * 2) / 2;

        g_oTextMeasurer.SetTextPr(TextPr, this.Get_Theme());
        g_oTextMeasurer.SetFontSlot(fontslot_ASCII, 1);

        var TNewMetrics = { Ascent : null, Descent : null };
        var TempCount = this.Content.length;
        for ( var Index = 0; Index < TempCount; Index++ )
        {
            this.Content[Index].Recalculate_Measure2( TNewMetrics );
        }

        var TNewDescent = TNewMetrics.Descent;
        var TNewAscent  = TNewMetrics.Ascent;        

        var TNewHeight = 0;
        if ( null === TNewAscent || null === TNewDescent )
            TNewHeight = g_oTextMeasurer.GetHeight();
        else
            TNewHeight = -TNewDescent + TNewAscent;

        var Descent = g_oTextMeasurer.GetDescender();
        var Ascent  = g_oTextMeasurer.GetAscender();

        var Dy = Descent * (LineH * Count) / ( Ascent - Descent ) + TNewHeight - TNewAscent + LineTD;

        var PTextPr = new ParaTextPr( { RFonts : { Ascii : { Name : TextPr.RFonts.Ascii.Name, Index : -1 } }, FontSize : TextPr.FontSize, Position : Dy } );

        this.Select_All();
        this.Add( PTextPr );
        this.Selection_Remove();
    },

    Update_DropCapByHeight : function(_Height)
    {       
        // Ищем следующий параграф, к которому относится буквица
        var AnchorPara = this.Get_FrameAnchorPara();
        if ( null === AnchorPara || AnchorPara.Lines.length <= 0 )
            return 1;

        var Before = AnchorPara.Get_CompiledPr().ParaPr.Spacing.Before;
        var LineH  = AnchorPara.Lines[0].Bottom - AnchorPara.Lines[0].Top - Before;
        var LineTA = AnchorPara.Lines[0].Metrics.TextAscent2;
        var LineTD = AnchorPara.Lines[0].Metrics.TextDescent + AnchorPara.Lines[0].Metrics.LineGap;

        var Height = _Height - Before;

        this.Set_Spacing( { LineRule : linerule_Exact, Line : Height }, false );

        // Посчитаем количество строк
        var LinesCount = Math.ceil( Height / LineH );

        var TextPr = this.Internal_CalculateTextPr(this.Internal_GetStartPos());
        g_oTextMeasurer.SetTextPr(TextPr, this.Get_Theme());
        g_oTextMeasurer.SetFontSlot(fontslot_ASCII, 1);

        var TMetrics = { Ascent : null, Descent : null };
        var TempCount = this.Content.length;
        for ( var Index = 0; Index < TempCount; Index++ )
        {
            this.Content[Index].Recalculate_Measure2( TMetrics );
        }

        var TDescent = TMetrics.Descent;
        var TAscent  = TMetrics.Ascent;

        var THeight = 0;
        if ( null === TAscent || null === TDescent )
            THeight = g_oTextMeasurer.GetHeight();
        else
            THeight = -TDescent + TAscent;

        var Koef = (Height - LineTD) / THeight;

        var NewFontSize = TextPr.FontSize * Koef;
        TextPr.FontSize = parseInt(NewFontSize * 2) / 2;

        g_oTextMeasurer.SetTextPr(TextPr, this.Get_Theme());
        g_oTextMeasurer.SetFontSlot(fontslot_ASCII, 1);

        var TNewMetrics = { Ascent : null, Descent : null };
        var TempCount = this.Content.length;
        for ( var Index = 0; Index < TempCount; Index++ )
        {
            this.Content[Index].Recalculate_Measure2( TNewMetrics );
        }

        var TNewDescent = TNewMetrics.Descent;
        var TNewAscent  = TNewMetrics.Ascent;

        var TNewHeight = 0;
        if ( null === TNewAscent || null === TNewDescent )
            TNewHeight = g_oTextMeasurer.GetHeight();
        else
            TNewHeight = -TNewDescent + TNewAscent;

        var Descent = g_oTextMeasurer.GetDescender();
        var Ascent  = g_oTextMeasurer.GetAscender();

        var Dy = Descent * (Height) / ( Ascent - Descent ) + TNewHeight - TNewAscent + LineTD;

        var PTextPr = new ParaTextPr( { RFonts : { Ascii : { Name : TextPr.RFonts.Ascii.Name, Index : -1 } }, FontSize : TextPr.FontSize, Position : Dy } );
        this.Select_All();
        this.Add( PTextPr );
        this.Selection_Remove();

        return LinesCount;
    },

    Get_FrameAnchorPara : function()
    {
        var FramePr = this.Get_FramePr();
        if ( undefined === FramePr )
            return null;

        var Next = this.Get_DocumentNext();
        while ( null != Next )
        {
            if ( type_Paragraph === Next.GetType() )
            {
                var NextFramePr = Next.Get_FramePr();
                if ( undefined === NextFramePr || false === FramePr.Compare( NextFramePr ) )
                    return Next;
            }

            Next = Next.Get_DocumentNext();
        }

        return Next;
    },

    // Разделяем данный параграф
    Split : function(NewParagraph, Pos)
    {
        NewParagraph.DeleteCommentOnRemove = false;
        this.DeleteCommentOnRemove         = false;

        // Обнулим селект и курсор
        this.Selection_Remove();
        NewParagraph.Selection_Remove();

        // Переносим контент, идущий с текущей позиции в параграфе и до конца параграфа,
        // в новый параграф.

        var ContentPos = this.Get_ParaContentPos(false, false);
        var CurPos = ContentPos.Get(0);

        var TextPr = this.Get_TextPr(ContentPos);

        // Разделяем текущий элемент (возвращается правая, отделившаяся часть, если она null, тогда заменяем
        // ее на пустой ран с заданными настройками).
        var NewElement = this.Content[CurPos].Split( ContentPos, 1 );

        if ( null === NewElement )
        {
            NewElement = new ParaRun( NewParagraph );
            NewElement.Set_Pr( TextPr.Copy() );
        }

        // Теперь делим наш параграф на три части:
        // 1. До элемента с номером CurPos включительно (оставляем эту часть в исходном параграфе)
        // 2. После элемента с номером CurPos (добавляем эту часть в новый параграф)
        // 3. Новый элемент, полученный после разделения элемента с номером CurPos, который мы
        //    добавляем в начало нового параграфа.

        var NewContent = this.Content.slice( CurPos + 1 );
        this.Internal_Content_Remove2( CurPos + 1, this.Content.length - CurPos - 1 );

        // В старый параграф добавим ран с концом параграфа
        var EndRun = new ParaRun( this );
        EndRun.Add_ToContent( 0, new ParaEnd() );

        this.Internal_Content_Add( this.Content.length, EndRun );

        // Очищаем новый параграф и добавляем в него Right элемент и NewContent
        NewParagraph.Internal_Content_Remove2( 0, NewParagraph.Content.length );
        NewParagraph.Internal_Content_Concat( NewContent );
        NewParagraph.Internal_Content_Add( 0, NewElement );

        // Копируем все настройки в новый параграф. Делаем это после того как определили контент параграфов.
        NewParagraph.TextPr.Value = this.TextPr.Value.Copy();
        this.CopyPr( NewParagraph );

        // Если на данном параграфе заканчивалась секция, тогда переносим конец секции на новый параграф
        var SectPr = this.Get_SectionPr();
        if ( undefined !== SectPr )
        {
            this.Set_SectionPr( undefined );
            NewParagraph.Set_SectionPr( SectPr );
        }

        this.Cursor_MoveToEndPos( false, false );
        NewParagraph.Cursor_MoveToStartPos( false );

        NewParagraph.DeleteCommentOnRemove = true;
        this.DeleteCommentOnRemove         = true;
    },

    // Присоединяем контент параграфа Para к текущему параграфу
    Concat : function(Para)
    {
        this.DeleteCommentOnRemove = false;

        // Убираем метку конца параграфа у данного параграфа
        this.Remove_ParaEnd();
        
        // Если в параграфе Para были точки NearPos, за которыми нужно следить перенесем их в этот параграф
        var NearPosCount = Para.NearPosArray.length;
        for ( var Pos = 0; Pos < NearPosCount; Pos++ )
        {
            var ParaNearPos = Para.NearPosArray[Pos];
            
            // Подменяем ссылки на параграф (вложенные ссылки менять не надо, т.к. мы добавляем объекты целиком)
            ParaNearPos.Classes[0] = this;
            ParaNearPos.NearPos.Paragraph = this;
            ParaNearPos.NearPos.ContentPos.Data[0] += this.Content.length;
            
            this.NearPosArray.push(ParaNearPos);
        }
        
        // Добавляем содержимое второго параграфа к первому
        var NewContent = Para.Content.slice(0); // чтобы передать новый массив, а не ссылку на старый
        this.Internal_Content_Concat( NewContent );

        // Если на данном параграфе оканчивалась секция, тогда удаляем эту секцию
        this.Set_SectionPr( undefined );

        // Если на втором параграфе оканчивалась секция, тогда переносим конец секции на данный параграф
        var SectPr = Para.Get_SectionPr()
        if ( undefined !== SectPr )
        {
            Para.Set_SectionPr( undefined );
            this.Set_SectionPr( SectPr );
        }

        this.DeleteCommentOnRemove = true;
    },

    // Копируем настройки параграфа и последние текстовые настройки в новый параграф
    Continue : function(NewParagraph)
    {
        // Копируем настройки параграфа
        this.CopyPr( NewParagraph );

        // Копируем последние настройки текста
        var TextPr = this.Get_TextPr();
        var NewRun = new ParaRun( NewParagraph );
        NewRun.Set_Pr( TextPr );

        NewParagraph.Internal_Content_Add( 0, NewRun );
        NewParagraph.Cursor_MoveToStartPos( false );

        // Копируем настройки знака конца параграфа
        NewParagraph.TextPr.Value = this.TextPr.Value.Copy();
    },

//-----------------------------------------------------------------------------------
// Undo/Redo функции
//-----------------------------------------------------------------------------------
    Undo : function(Data)
    {
        var Type = Data.Type;

        switch ( Type )
        {
            case  historyitem_Paragraph_AddItem:
            {
                var StartPos = Data.Pos;
                var EndPos   = Data.EndPos;

                this.Content.splice( StartPos, EndPos - StartPos + 1 );

                break;
            }

            case historyitem_Paragraph_RemoveItem:
            {
                var Pos = Data.Pos;

                var Array_start = this.Content.slice( 0, Pos );
                var Array_end   = this.Content.slice( Pos );

                this.Content = Array_start.concat( Data.Items, Array_end );

                break;
            }

            case historyitem_Paragraph_Numbering:
            {
                var Old = Data.Old;
                if ( undefined != Old )
                    this.Pr.NumPr = Old;
                else
                    this.Pr.NumPr = undefined;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Align:
            {
                this.Pr.Jc = Data.Old;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Ind_First:
            {
                if ( undefined === this.Pr.Ind )
                    this.Pr.Ind = new CParaSpacing();

                this.Pr.Ind.FirstLine = Data.Old;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Ind_Left:
            {
                if ( undefined === this.Pr.Ind )
                    this.Pr.Ind = new CParaSpacing();

                this.Pr.Ind.Left = Data.Old;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Ind_Right:
            {
                if ( undefined === this.Pr.Ind )
                    this.Pr.Ind = new CParaSpacing();

                this.Pr.Ind.Right = Data.Old;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_ContextualSpacing:
            {
                this.Pr.ContextualSpacing = Data.Old;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_KeepLines:
            {
                this.Pr.KeepLines = Data.Old;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_KeepNext:
            {
                this.Pr.KeepNext = Data.Old;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_PageBreakBefore:
            {
                this.Pr.PageBreakBefore = Data.Old;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Spacing_Line:
            {
                if ( undefined === this.Pr.Spacing )
                    this.Pr.Spacing = new CParaSpacing();

                this.Pr.Spacing.Line = Data.Old;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Spacing_LineRule:
            {
                if ( undefined === this.Pr.Spacing )
                    this.Pr.Spacing = new CParaSpacing();

                this.Pr.Spacing.LineRule = Data.Old;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Spacing_Before:
            {
                if ( undefined === this.Pr.Spacing )
                    this.Pr.Spacing = new CParaSpacing();

                this.Pr.Spacing.Before = Data.Old;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Spacing_After:
            {
                if ( undefined === this.Pr.Spacing )
                    this.Pr.Spacing = new CParaSpacing();

                this.Pr.Spacing.After = Data.Old;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Spacing_AfterAutoSpacing:
            {
                if ( undefined === this.Pr.Spacing )
                    this.Pr.Spacing = new CParaSpacing();

                this.Pr.Spacing.AfterAutoSpacing = Data.Old;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Spacing_BeforeAutoSpacing:
            {
                if ( undefined === this.Pr.Spacing )
                    this.Pr.Spacing = new CParaSpacing();

                this.Pr.Spacing.BeforeAutoSpacing = Data.Old;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Shd_Value:
            {
                if ( undefined != Data.Old && undefined === this.Pr.Shd )
                    this.Pr.Shd = new CDocumentShd();

                if ( undefined != Data.Old )
                    this.Pr.Shd.Value = Data.Old;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Shd_Color:
            {
                if ( undefined != Data.Old && undefined === this.Pr.Shd )
                    this.Pr.Shd = new CDocumentShd();

                if ( undefined != Data.Old )
                    this.Pr.Shd.Color = Data.Old;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Shd_Unifill:
            {
                if ( undefined != Data.Old && undefined === this.Pr.Shd )
                    this.Pr.Shd = new CDocumentShd();

                if ( undefined != Data.Old )
                    this.Pr.Shd.Unifill = Data.Old;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Shd:
            {
                this.Pr.Shd = Data.Old;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_WidowControl:
            {
                this.Pr.WidowControl = Data.Old;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Tabs:
            {
                this.Pr.Tabs = Data.Old;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_PStyle:
            {
                var Old = Data.Old;
                if ( undefined != Old )
                    this.Pr.PStyle = Old;
                else
                    this.Pr.PStyle = undefined;

                this.CompiledPr.NeedRecalc = true;
                this.Recalc_RunsCompiledPr();

                break;
            }

            case historyitem_Paragraph_DocNext:
            {
                this.Next = Data.Old;
                break;
            }

            case historyitem_Paragraph_DocPrev:
            {
                this.Prev = Data.Old;
                break;
            }

            case historyitem_Paragraph_Parent:
            {
                this.Parent = Data.Old;
                break;
            }

            case historyitem_Paragraph_Borders_Between:
            {
                this.Pr.Brd.Between = Data.Old;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Borders_Bottom:
            {
                this.Pr.Brd.Bottom = Data.Old;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Borders_Left:
            {
                this.Pr.Brd.Left = Data.Old;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Borders_Right:
            {
                this.Pr.Brd.Right = Data.Old;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Borders_Top:
            {
                this.Pr.Brd.Top = Data.Old;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Pr:
            {
                var Old = Data.Old;
                if ( undefined != Old )
                    this.Pr = Old;
                else
                    this.Pr = new CParaPr();

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_PresentationPr_Bullet:
            {
                this.Pr.Bullet = Data.Old;
                this.CompiledPr.NeedRecalc = true;
                break;
            }

            case historyitem_Paragraph_PresentationPr_Level:
            {
                this.Pr.Lvl = Data.Old;
                this.CompiledPr.NeedRecalc = true;
                this.Recalc_RunsCompiledPr();
                break;
            }

            case historyitem_Paragraph_FramePr:
            {
                this.Pr.FramePr = Data.Old;
                this.CompiledPr.NeedRecalc = true;
                break;
            }

            case historyitem_Paragraph_SectionPr:
            {
                this.SectPr = Data.Old;
                this.LogicDocument.Update_SectionsInfo();
                break;
            }

            case historyitem_Paragraph_Bullet:
            {
                this.Pr.Bullet = Data.Old;
                this.CompiledPr.NeedRecalc = true;
                break;
            }
        }

        this.RecalcInfo.Set_Type_0(pararecalc_0_All);
        this.RecalcInfo.Set_Type_0_Spell(pararecalc_0_Spell_All);
    },

    Redo : function(Data)
    {
        var Type = Data.Type;

        switch ( Type )
        {
            case  historyitem_Paragraph_AddItem:
            {
                var Pos = Data.Pos;

                var Array_start = this.Content.slice( 0, Pos );
                var Array_end   = this.Content.slice( Pos );

                this.Content = Array_start.concat( Data.Items, Array_end );

                break;

            }

            case historyitem_Paragraph_RemoveItem:
            {
                var StartPos = Data.Pos;
                var EndPos   = Data.EndPos;

                this.Content.splice( StartPos, EndPos - StartPos + 1 );

                break;
            }

            case historyitem_Paragraph_Numbering:
            {
                var New = Data.New;
                if ( undefined != New )
                    this.Pr.NumPr = New;
                else
                    this.Pr.NumPr = undefined;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Align:
            {
                this.Pr.Jc = Data.New;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Ind_First:
            {
                if ( undefined === this.Pr.Ind )
                    this.Pr.Ind = new CParaInd();

                this.Pr.Ind.FirstLine = Data.New;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Ind_Left:
            {
                if ( undefined === this.Pr.Ind )
                    this.Pr.Ind = new CParaInd();

                this.Pr.Ind.Left = Data.New;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Ind_Right:
            {
                if ( undefined === this.Pr.Ind )
                    this.Pr.Ind = new CParaInd();

                this.Pr.Ind.Right = Data.New;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_ContextualSpacing:
            {
                this.Pr.ContextualSpacing = Data.New;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_KeepLines:
            {
                this.Pr.KeepLines = Data.New;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_KeepNext:
            {
                this.Pr.KeepNext = Data.New;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_PageBreakBefore:
            {
                this.Pr.PageBreakBefore = Data.New;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Spacing_Line:
            {
                if ( undefined === this.Pr.Spacing )
                    this.Pr.Spacing = new CParaSpacing();

                this.Pr.Spacing.Line = Data.New;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Spacing_LineRule:
            {
                if ( undefined === this.Pr.Spacing )
                    this.Pr.Spacing = new CParaSpacing();

                this.Pr.Spacing.LineRule = Data.New;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Spacing_Before:
            {
                if ( undefined === this.Pr.Spacing )
                    this.Pr.Spacing = new CParaSpacing();

                this.Pr.Spacing.Before = Data.New;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Spacing_After:
            {
                if ( undefined === this.Pr.Spacing )
                    this.Pr.Spacing = new CParaSpacing();

                this.Pr.Spacing.After = Data.New;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Spacing_AfterAutoSpacing:
            {
                if ( undefined === this.Pr.Spacing )
                    this.Pr.Spacing = new CParaSpacing();

                this.Pr.Spacing.AfterAutoSpacing = Data.New;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Spacing_BeforeAutoSpacing:
            {
                if ( undefined === this.Pr.Spacing )
                    this.Pr.Spacing = new CParaSpacing();

                this.Pr.Spacing.BeforeAutoSpacing = Data.New;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Shd_Value:
            {
                if ( undefined != Data.New && undefined === this.Pr.Shd )
                    this.Pr.Shd = new CDocumentShd();

                if ( undefined != Data.New )
                    this.Pr.Shd.Value = Data.New;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Shd_Color:
            {
                if ( undefined != Data.New && undefined === this.Pr.Shd )
                    this.Pr.Shd = new CDocumentShd();

                if ( undefined != Data.New )
                    this.Pr.Shd.Color = Data.New;

                this.CompiledPr.NeedRecalc = true;

                break;
            }
            case historyitem_Paragraph_Shd_Unifill:
            {
                if ( undefined != Data.New && undefined === this.Pr.Shd )
                    this.Pr.Shd = new CDocumentShd();

                if ( undefined != Data.New )
                    this.Pr.Shd.Unifill = Data.New;

                this.CompiledPr.NeedRecalc = true;
                break;
            }


            case historyitem_Paragraph_Shd:
            {
                this.Pr.Shd = Data.New;

                this.CompiledPr.NeedRecalc = true;

                break;
            }


            case historyitem_Paragraph_WidowControl:
            {
                this.Pr.WidowControl = Data.New;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Tabs:
            {
                this.Pr.Tabs = Data.New;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_PStyle:
            {
                var New = Data.New;
                if ( undefined != New )
                    this.Pr.PStyle = New;
                else
                    this.Pr.PStyle = undefined;

                this.CompiledPr.NeedRecalc = true;
                this.Recalc_RunsCompiledPr();

                break;
            }

            case historyitem_Paragraph_DocNext:
            {
                this.Next = Data.New;
                break;
            }

            case historyitem_Paragraph_DocPrev:
            {
                this.Prev = Data.New;
                break;
            }

            case historyitem_Paragraph_Parent:
            {
                this.Parent = Data.New;
                break;
            }

            case historyitem_Paragraph_Borders_Between:
            {
                this.Pr.Brd.Between = Data.New;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Borders_Bottom:
            {
                this.Pr.Brd.Bottom = Data.New;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Borders_Left:
            {
                this.Pr.Brd.Left = Data.New;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Borders_Right:
            {
                this.Pr.Brd.Right = Data.New;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Borders_Top:
            {
                this.Pr.Brd.Top = Data.New;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Pr:
            {
                var New = Data.New;
                if ( undefined != New )
                    this.Pr = New;
                else
                    this.Pr = new CParaPr();

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_PresentationPr_Bullet:
            {
                this.Pr.Bullet = Data.New;
                this.CompiledPr.NeedRecalc = true;
                break;
            }

            case historyitem_Paragraph_PresentationPr_Level:
            {
                this.Pr.Lvl = Data.New;
                this.CompiledPr.NeedRecalc = true;
                this.Recalc_RunsCompiledPr();
                break;
            }

            case historyitem_Paragraph_FramePr:
            {
                this.Pr.FramePr = Data.New;
                this.CompiledPr.NeedRecalc = true;
                break;
            }

            case historyitem_Paragraph_SectionPr:
            {
                this.SectPr = Data.New;
                this.LogicDocument.Update_SectionsInfo();
                break;
            }

            case historyitem_Paragraph_Bullet:
            {
                this.Pr.Bullet = Data.New;
                this.CompiledPr.NeedRecalc = true;
                break;
            }
        }

        this.RecalcInfo.Set_Type_0(pararecalc_0_All);
        this.RecalcInfo.Set_Type_0_Spell(pararecalc_0_Spell_All);
    },

    Get_SelectionState : function()
    {
        var ParaState = {};
        ParaState.CurPos  =
        {
            X          : this.CurPos.X,
            Y          : this.CurPos.Y,
            Line       : this.CurPos.Line,
            ContentPos : ( true === this.Selection.Use ?  this.Get_ParaContentPos( true, false ) :  this.Get_ParaContentPos( false, false ) ),
            RealX      : this.CurPos.RealX,
            RealY      : this.CurPos.RealY,
            PagesPos   : this.CurPos.PagesPos
        };

        ParaState.Selection =
        {
            Start    : this.Selection.Start,
            Use      : this.Selection.Use,
            StartPos : 0,
            EndPos   : 0,
            Flag     : this.Selection.Flag
        };

        if ( true === this.Selection.Use )
        {
            ParaState.Selection.StartPos = this.Get_ParaContentPos( true, true );
            ParaState.Selection.EndPos   = this.Get_ParaContentPos( true, false );
        }

        return [ ParaState ];
    },

    Set_SelectionState : function(State, StateIndex)
    {
        if ( State.length <= 0 )
            return;

        var ParaState = State[StateIndex];

        this.CurPos.X          = ParaState.CurPos.X;
        this.CurPos.Y          = ParaState.CurPos.Y;
        this.CurPos.Line       = ParaState.CurPos.Line;
        this.CurPos.RealX      = ParaState.CurPos.RealX;
        this.CurPos.RealY      = ParaState.CurPos.RealY;
        this.CurPos.PagesPos   = ParaState.CurPos.PagesPos;

        this.Set_ParaContentPos(ParaState.CurPos.ContentPos, true, -1, -1);

        this.Selection_Remove();

        this.Selection.Start = ParaState.Selection.Start;
        this.Selection.Use   = ParaState.Selection.Use;
        this.Selection.Flag  = ParaState.Selection.Flag;

        if ( true === this.Selection.Use )
            this.Set_SelectionContentPos( ParaState.Selection.StartPos, ParaState.Selection.EndPos );
    },

    Get_ParentObject_or_DocumentPos : function()
    {
        return this.Parent.Get_ParentObject_or_DocumentPos(this.Index);
    },

    Refresh_RecalcData : function(Data)
    {
        var Type = Data.Type;

        var bNeedRecalc = false;

        var CurPage = 0;

        switch ( Type )
        {
            case historyitem_Paragraph_AddItem:
            case historyitem_Paragraph_RemoveItem:
            {
                for ( CurPage = this.Pages.length - 1; CurPage > 0; CurPage-- )
                {
                    if ( Data.Pos > this.Lines[this.Pages[CurPage].StartLine].StartPos )
                        break;
                }

                this.RecalcInfo.Set_Type_0(pararecalc_0_All);
                bNeedRecalc = true;
                break;
            }
            case historyitem_Paragraph_Numbering:
            case historyitem_Paragraph_PStyle:
            case historyitem_Paragraph_Pr:
            case historyitem_Paragraph_PresentationPr_Bullet:
            case historyitem_Paragraph_PresentationPr_Level:
            {
                this.RecalcInfo.Set_Type_0(pararecalc_0_All);
                bNeedRecalc = true;
                break;
            }

            case historyitem_Paragraph_Align:
            case historyitem_Paragraph_Ind_First:
            case historyitem_Paragraph_Ind_Left:
            case historyitem_Paragraph_Ind_Right:
            case historyitem_Paragraph_ContextualSpacing:
            case historyitem_Paragraph_KeepLines:
            case historyitem_Paragraph_KeepNext:
            case historyitem_Paragraph_PageBreakBefore:
            case historyitem_Paragraph_Spacing_Line:
            case historyitem_Paragraph_Spacing_LineRule:
            case historyitem_Paragraph_Spacing_Before:
            case historyitem_Paragraph_Spacing_After:
            case historyitem_Paragraph_Spacing_AfterAutoSpacing:
            case historyitem_Paragraph_Spacing_BeforeAutoSpacing:
            case historyitem_Paragraph_WidowControl:
            case historyitem_Paragraph_Tabs:
            case historyitem_Paragraph_Parent:
            case historyitem_Paragraph_Borders_Between:
            case historyitem_Paragraph_Borders_Bottom:
            case historyitem_Paragraph_Borders_Left:
            case historyitem_Paragraph_Borders_Right:
            case historyitem_Paragraph_Borders_Top:
            case historyitem_Paragraph_FramePr:
            {
                bNeedRecalc = true;
                break;
            }
            case historyitem_Paragraph_Shd_Value:
            case historyitem_Paragraph_Shd_Color:
            case historyitem_Paragraph_Shd_Unifill:
            case historyitem_Paragraph_Shd:
            case historyitem_Paragraph_DocNext:
            case historyitem_Paragraph_DocPrev:
            {
                // Пересчитывать этот элемент не надо при таких изменениях
                break;
            }
        }

        if ( true === bNeedRecalc )
        {
            var Prev = this.Get_DocumentPrev();
            if ( 0 === CurPage && null != Prev && type_Paragraph === Prev.GetType() && true === Prev.Get_CompiledPr2(false).ParaPr.KeepNext )
                Prev.Refresh_RecalcData2( Prev.Pages.length - 1 );

            // Сообщаем родительскому классу, что изменения произошли в элементе с номером this.Index и на странице this.PageNum
            return this.Refresh_RecalcData2(CurPage);
        }
    },

    Refresh_RecalcData2 : function(CurPage)
    {
        if ( undefined === CurPage )
            CurPage = 0;

        // Если Index < 0, значит данный элемент еще не был добавлен в родительский класс
        if ( this.Index >= 0 )
            this.Parent.Refresh_RecalcData2( this.Index, this.PageNum + CurPage );
    },
//-----------------------------------------------------------------------------------
// Функции для совместного редактирования
//-----------------------------------------------------------------------------------
    Document_Is_SelectionLocked : function(CheckType)
    {
        switch ( CheckType )
        {
            case changestype_Paragraph_Content:
            case changestype_Paragraph_Properties:
            case changestype_Document_Content:
            case changestype_Document_Content_Add:
            case changestype_Image_Properties:
            {
                this.Lock.Check( this.Get_Id() );
                break;
            }
            case changestype_Remove:
            {
                // Если у нас нет выделения, и курсор стоит в начале, мы должны проверить в том же порядке, в каком
                // идут проверки при удалении в команде Internal_Remove_Backward.
                if ( true != this.Selection.Use && true == this.Cursor_IsStart() )
                {
                    var Pr = this.Get_CompiledPr2(false).ParaPr;
                    if ( undefined != this.Numbering_Get() || Math.abs(Pr.Ind.FirstLine) > 0.001 || Math.abs(Pr.Ind.Left) > 0.001 )
                    {
                        // Надо проверить только текущий параграф, а это будет сделано далее
                    }
                    else
                    {
                        var Prev = this.Get_DocumentPrev();
                        if ( null != Prev && type_Paragraph === Prev.GetType() )
                            Prev.Lock.Check( Prev.Get_Id() );
                    }
                }
                // Если есть выделение, и знак параграфа попал в выделение ( и параграф выделен не целиком )
                else if ( true === this.Selection.Use )
                {
                    var StartPos = this.Selection.StartPos;
                    var EndPos   = this.Selection.EndPos;

                    if ( StartPos > EndPos )
                    {
                        var Temp = EndPos;
                        EndPos   = StartPos;
                        StartPos = Temp;
                    }

                    if ( EndPos >= this.Content.length - 1 && StartPos > this.Internal_GetStartPos() )
                    {
                        var Next = this.Get_DocumentNext();
                        if ( null != Next && type_Paragraph === Next.GetType() )
                            Next.Lock.Check( Next.Get_Id() );
                    }
                }

                this.Lock.Check( this.Get_Id() );

                break;
            }
            case changestype_Delete:
            {
                // Если у нас нет выделения, и курсор стоит в конце, мы должны проверить следующий элемент
                if ( true != this.Selection.Use && true === this.Cursor_IsEnd() )
                {
                    var Next = this.Get_DocumentNext();
                    if ( null != Next && type_Paragraph === Next.GetType() )
                        Next.Lock.Check( Next.Get_Id() );
                }
                // Если есть выделение, и знак параграфа попал в выделение и параграф выделен не целиком
                else if ( true === this.Selection.Use )
                {
                    var StartPos = this.Selection.StartPos;
                    var EndPos   = this.Selection.EndPos;

                    if ( StartPos > EndPos )
                    {
                        var Temp = EndPos;
                        EndPos   = StartPos;
                        StartPos = Temp;
                    }

                    if ( EndPos >= this.Content.length - 1 && StartPos > this.Internal_GetStartPos() )
                    {
                        var Next = this.Get_DocumentNext();
                        if ( null != Next && type_Paragraph === Next.GetType() )
                            Next.Lock.Check( Next.Get_Id() );
                    }
                }

                this.Lock.Check( this.Get_Id() );

                break;
            }
            case changestype_Document_SectPr:
            case changestype_Table_Properties:
            case changestype_Table_RemoveCells:
            case changestype_HdrFtr:
            {
                CollaborativeEditing.Add_CheckLock(true);
                break;
            }
        }
    },

    Save_Changes : function(Data, Writer)
    {
        // Сохраняем изменения из тех, которые используются для Undo/Redo в бинарный файл.
        // Long : тип класса
        // Long : тип изменений

        Writer.WriteLong( historyitem_type_Paragraph );

        var Type = Data.Type;

        // Пишем тип
        Writer.WriteLong( Type );

        switch ( Type )
        {
            case  historyitem_Paragraph_AddItem:
            {
                // Long     : Количество элементов
                // Array of :
                //  {
                //    Long     : Позиция
                //    Variable : Id элемента
                //  }

                var bArray = Data.UseArray;
                var Count  = Data.Items.length;

                Writer.WriteLong( Count );

                for ( var Index = 0; Index < Count; Index++ )
                {
                    if ( true === bArray )
                        Writer.WriteLong( Data.PosArray[Index] );
                    else
                        Writer.WriteLong( Data.Pos + Index );

                    Writer.WriteString2( Data.Items[Index].Get_Id() );
                }

                break;
            }

            case historyitem_Paragraph_RemoveItem:
            {
                // Long          : Количество удаляемых элементов
                // Array of Long : позиции удаляемых элементов

                var bArray = Data.UseArray;
                var Count  = Data.Items.length;

                var StartPos = Writer.GetCurPosition();
                Writer.Skip(4);
                var RealCount = Count;

                for ( var Index = 0; Index < Count; Index++ )
                {
                    if ( true === bArray )
                    {
                        if ( false === Data.PosArray[Index] )
                            RealCount--;
                        else
                            Writer.WriteLong( Data.PosArray[Index] );
                    }
                    else
                        Writer.WriteLong( Data.Pos );
                }

                var EndPos = Writer.GetCurPosition();
                Writer.Seek( StartPos );
                Writer.WriteLong( RealCount );
                Writer.Seek( EndPos );

                break;
            }

            case historyitem_Paragraph_Numbering:
            {
                // Bool : IsUndefined
                // Если false
                //   Variable : NumPr (CNumPr)

                if ( undefined === Data.New )
                    Writer.WriteBool( true );
                else
                {
                    Writer.WriteBool( false );
                    Data.New.Write_ToBinary( Writer );
                }

                break;
            }

            case historyitem_Paragraph_Ind_First:
            case historyitem_Paragraph_Ind_Left:
            case historyitem_Paragraph_Ind_Right:
            case historyitem_Paragraph_Spacing_Line:
            case historyitem_Paragraph_Spacing_Before:
            case historyitem_Paragraph_Spacing_After:
            {
                // Bool : IsUndefined

                // Если false
                // Double : Value

                if ( undefined === Data.New )
                {
                    Writer.WriteBool( true );
                }
                else
                {
                    Writer.WriteBool( false );
                    Writer.WriteDouble( Data.New );
                }

                break;
            }

            case historyitem_Paragraph_Align:
            case historyitem_Paragraph_Spacing_LineRule:
            {
                // Bool : IsUndefined

                // Если false
                // Long : Value

                if ( undefined === Data.New )
                {
                    Writer.WriteBool( true );
                }
                else
                {
                    Writer.WriteBool( false );
                    Writer.WriteLong( Data.New );
                }

                break;
            }

            case historyitem_Paragraph_ContextualSpacing:
            case historyitem_Paragraph_KeepLines:
            case historyitem_Paragraph_KeepNext:
            case historyitem_Paragraph_PageBreakBefore:
            case historyitem_Paragraph_Spacing_AfterAutoSpacing:
            case historyitem_Paragraph_Spacing_BeforeAutoSpacing:
            case historyitem_Paragraph_WidowControl:
            {
                // Bool : IsUndefined

                // Если false
                // Bool : Value

                if ( undefined === Data.New )
                {
                    Writer.WriteBool( true );
                }
                else
                {
                    Writer.WriteBool( false );
                    Writer.WriteBool( Data.New );
                }

                break;
            }

            case historyitem_Paragraph_Shd_Value:
            {
                // Bool : IsUndefined

                // Если false
                // Byte : Value

                var New = Data.New;
                if ( undefined != New )
                {
                    Writer.WriteBool( false );
                    Writer.WriteByte( Data.New );
                }
                else
                    Writer.WriteBool( true );

                break;
            }

            case historyitem_Paragraph_Shd_Color:
            case historyitem_Paragraph_Shd_Unifill:
            {
                // Bool : IsUndefined

                // Если false
                // Variable : Color (CDocumentColor)

                var New = Data.New;
                if ( undefined != New )
                {
                    Writer.WriteBool( false );
                    Data.New.Write_ToBinary(Writer);
                }
                else
                    Writer.WriteBool( true );

                break;
            }

            case historyitem_Paragraph_Shd:
            {
                // Bool : IsUndefined

                // Если false
                // Variable : Shd (CDocumentShd)

                var New = Data.New;
                if ( undefined != New )
                {
                    Writer.WriteBool( false );
                    Data.New.Write_ToBinary(Writer);
                }
                else
                    Writer.WriteBool( true );

                break;
            }


            case historyitem_Paragraph_Tabs:
            {
                // Bool : IsUndefined
                // Есди false
                // Variable : CParaTabs

                if ( undefined != Data.New )
                {
                    Writer.WriteBool( false );
                    Data.New.Write_ToBinary( Writer );
                }
                else
                    Writer.WriteBool(true);

                break;
            }

            case historyitem_Paragraph_PStyle:
            {
                // Bool : Удаляем ли

                // Если false
                // String : StyleId

                if ( undefined != Data.New )
                {
                    Writer.WriteBool( false );
                    Writer.WriteString2( Data.New );
                }
                else
                    Writer.WriteBool( true );

                break;
            }

            case historyitem_Paragraph_DocNext:
            case historyitem_Paragraph_DocPrev:
            case historyitem_Paragraph_Parent:
            {
                // String : Id элемента

//                if ( null != Data.New )
//                    Writer.WriteString2( Data.New.Get_Id() );
//                else
//                    Writer.WriteString2( "" );

                break;
            }

            case historyitem_Paragraph_Borders_Between:
            case historyitem_Paragraph_Borders_Bottom:
            case historyitem_Paragraph_Borders_Left:
            case historyitem_Paragraph_Borders_Right:
            case historyitem_Paragraph_Borders_Top:
            {
                // Bool : IsUndefined
                // если false
                //  Variable : Border (CDocumentBorder)

                if ( undefined != Data.New )
                {
                    Writer.WriteBool( false );
                    Data.New.Write_ToBinary( Writer );
                }
                else
                    Writer.WriteBool( true );

                break;
            }

            case historyitem_Paragraph_Pr:
            {
                // Bool : удаляем ли

                if ( undefined === Data.New )
                    Writer.WriteBool( true );
                else
                {
                    Writer.WriteBool( false );
                    Data.New.Write_ToBinary( Writer );
                }

                break;
            }

            case historyitem_Paragraph_PresentationPr_Bullet:
            {
                // Variable : Bullet
                Data.New.Write_ToBinary( Writer );

                break;
            }

            case historyitem_Paragraph_PresentationPr_Level:
            {
                // Long : Level
                Writer.WriteLong( Data.New );
                break;
            }

            case historyitem_Paragraph_FramePr:
            {
                // Bool : IsUndefined
                // false ->
                //   Variable : CFramePr

                if ( undefined === Data.New )
                    Writer.WriteBool( true );
                else
                {
                    Writer.WriteBool( false );
                    Data.New.Write_ToBinary( Writer );
                }

                break;
            }

            case historyitem_Paragraph_SectionPr:
            {
                // Bool : IsUndefined
                // false ->
                //   String2 : SectPr.Id

                if ( undefined === Data.New )
                    Writer.WriteBool( true );
                else
                {
                    Writer.WriteBool( false );
                    Writer.WriteString2( Data.New.Get_Id() );
                }

                break;
            }

        }

        return Writer;
    },

    Load_Changes : function(Reader)
    {
        // Сохраняем изменения из тех, которые используются для Undo/Redo в бинарный файл.
        // Long : тип класса
        // Long : тип изменений

        var ClassType = Reader.GetLong();
        if ( historyitem_type_Paragraph != ClassType )
            return;

        var Type = Reader.GetLong();

        switch ( Type )
        {
            case  historyitem_Paragraph_AddItem:
            {
                // Long     : Количество элементов
                // Array of :
                //  {
                //    Long     : Позиция
                //    Variable : Id Элемента
                //  }

                var Count = Reader.GetLong();

                for ( var Index = 0; Index < Count; Index++ )
                {
                    var Pos     = this.m_oContentChanges.Check( contentchanges_Add, Reader.GetLong() );
                    var Element = g_oTableId.Get_ById( Reader.GetString2() );

                    if ( null != Element )
                    {
                        if ( para_Comment === Element.Type )
                        {
                            var Comment = g_oTableId.Get_ById( Element.CommentId );

                            if ( null != Comment )
                            {
                                if ( true === Element.Start )
                                    Comment.Set_StartId( this.Get_Id() );
                                else
                                    Comment.Set_EndId( this.Get_Id() );
                            }
                        }

                        this.Content.splice( Pos, 0, Element );
                    }
                }

                break;
            }

            case historyitem_Paragraph_RemoveItem:
            {
                // Long          : Количество удаляемых элементов
                // Array of Long : позиции удаляемых элементов

                var Count = Reader.GetLong();

                for ( var Index = 0; Index < Count; Index++ )
                {
                    var ChangesPos = this.m_oContentChanges.Check( contentchanges_Remove, Reader.GetLong() );

                    // действие совпало, не делаем его
                    if ( false === ChangesPos )
                        continue;

                    this.Content.splice( ChangesPos, 1 );
                }

                break;
            }

            case historyitem_Paragraph_Numbering:
            {
                // Bool : IsUndefined
                // Если false
                //   Variable : NumPr (CNumPr)

                if ( true === Reader.GetBool() )
                    this.Pr.NumPr = undefined;
                else
                {
                    this.Pr.NumPr = new CNumPr();
                    this.Pr.NumPr.Read_FromBinary(Reader);
                }

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Align:
            {
                // Bool : IsUndefined

                // Если false
                // Long : Value

                if ( true === Reader.GetBool() )
                    this.Pr.Jc = undefined;
                else
                    this.Pr.Jc = Reader.GetLong();

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Ind_First:
            {
                // Bool : IsUndefined

                // Если false
                // Double : Value

                if ( undefined === this.Pr.Ind )
                    this.Pr.Ind = new CParaInd();

                if ( true === Reader.GetBool() )
                    this.Pr.Ind.FirstLine = undefined;
                else
                    this.Pr.Ind.FirstLine = Reader.GetDouble();

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Ind_Left:
            {
                // Bool : IsUndefined

                // Если false
                // Double : Value

                if ( undefined === this.Pr.Ind )
                    this.Pr.Ind = new CParaInd();

                if ( true === Reader.GetBool() )
                    this.Pr.Ind.Left = undefined;
                else
                    this.Pr.Ind.Left = Reader.GetDouble();

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Ind_Right:
            {
                // Bool : IsUndefined

                // Если false
                // Double : Value

                if ( undefined === this.Pr.Ind )
                    this.Pr.Ind = new CParaInd();

                if ( true === Reader.GetBool() )
                    this.Pr.Ind.Right = undefined;
                else
                    this.Pr.Ind.Right = Reader.GetDouble();

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_ContextualSpacing:
            {
                // Bool : IsUndefined

                // Если false
                // Bool : Value

                if ( true === Reader.GetBool() )
                    this.Pr.ContextualSpacing = undefined;
                else
                    this.Pr.ContextualSpacing = Reader.GetBool();

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_KeepLines:
            {
                // Bool : IsUndefined

                // Если false
                // Bool : Value

                if ( false === Reader.GetBool() )
                    this.Pr.KeepLines = Reader.GetBool();
                else
                    this.Pr.KeepLines = undefined;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_KeepNext:
            {
                // Bool : IsUndefined

                // Если false
                // Bool : Value

                if ( false === Reader.GetBool() )
                    this.Pr.KeepNext = Reader.GetBool();
                else
                    this.Pr.KeepNext = undefined;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_PageBreakBefore:
            {
                // Bool : IsUndefined

                // Если false
                // Bool : Value

                if ( false === Reader.GetBool() )
                    this.Pr.PageBreakBefore = Reader.GetBool();
                else
                    this.Pr.PageBreakBefore = undefined;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Spacing_Line:
            {
                // Bool : IsUndefined

                // Если false
                // Double : Value

                if ( undefined === this.Pr.Spacing )
                    this.Pr.Spacing = new CParaSpacing();

                if ( false === Reader.GetBool() )
                    this.Pr.Spacing.Line = Reader.GetDouble();
                else
                    this.Pr.Spacing.Line = undefined;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Spacing_LineRule:
            {
                // Bool : IsUndefined

                // Если false
                // Long : Value

                if ( undefined === this.Pr.Spacing )
                    this.Pr.Spacing = new CParaSpacing();

                if ( false === Reader.GetBool() )
                    this.Pr.Spacing.LineRule = Reader.GetLong();
                else
                    this.Pr.Spacing.LineRule = undefined;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Spacing_Before:
            {
                // Bool : IsUndefined

                // Если false
                // Double : Value

                if ( undefined === this.Pr.Spacing )
                    this.Pr.Spacing = new CParaSpacing();

                if ( false === Reader.GetBool() )
                    this.Pr.Spacing.Before = Reader.GetDouble();
                else
                    this.Pr.Spacing.Before = undefined;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Spacing_After:
            {
                // Bool : IsUndefined

                // Если false
                // Double : Value

                if ( undefined === this.Pr.Spacing )
                    this.Pr.Spacing = new CParaSpacing();

                if ( false === Reader.GetBool() )
                    this.Pr.Spacing.After = Reader.GetDouble();
                else
                    this.Pr.Spacing.After = undefined;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Spacing_AfterAutoSpacing:
            {
                // Bool : IsUndefined

                // Если false
                // Bool : Value

                if ( undefined === this.Pr.Spacing )
                    this.Pr.Spacing = new CParaSpacing();

                if ( false === Reader.GetBool() )
                    this.Pr.Spacing.AfterAutoSpacing = Reader.GetBool();
                else
                    this.Pr.Spacing.AfterAutoSpacing = undefined;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Spacing_BeforeAutoSpacing:
            {
                // Bool : IsUndefined

                // Если false
                // Bool : Value

                if ( undefined === this.Pr.Spacing )
                    this.Pr.Spacing = new CParaSpacing();

                if ( false === Reader.GetBool() )
                    this.Pr.Spacing.AfterAutoSpacing = Reader.GetBool();
                else
                    this.Pr.Spacing.BeforeAutoSpacing = undefined;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Shd_Value:
            {
                // Bool : IsUndefined
                // Если false
                // Byte : Value

                if ( false === Reader.GetBool() )
                {
                    if ( undefined === this.Pr.Shd )
                        this.Pr.Shd = new CDocumentShd();

                    this.Pr.Shd.Value = Reader.GetByte();
                }
                else if ( undefined != this.Pr.Shd )
                    this.Pr.Shd.Value = undefined;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Shd_Color:
            {
                // Bool : IsUndefined

                // Если false
                // Variable : Color (CDocumentColor)

                if ( false === Reader.GetBool() )
                {
                    if ( undefined === this.Pr.Shd )
                        this.Pr.Shd = new CDocumentShd();

                    this.Pr.Shd.Color = new CDocumentColor(0,0,0);
                    this.Pr.Shd.Color.Read_FromBinary(Reader);
                }
                else if ( undefined != this.Pr.Shd )
                    this.Pr.Shd.Color = undefined;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Shd_Unifill:
            {
                if ( false === Reader.GetBool() )
                {
                    if ( undefined === this.Pr.Shd )
                        this.Pr.Shd = new CDocumentShd();

                    this.Pr.Shd.Unifill = new CUniFill();
                    this.Pr.Shd.Unifill.Read_FromBinary(Reader);
                }
                else if ( undefined != this.Pr.Shd )
                    this.Pr.Shd.Unifill = undefined;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Shd:
            {
                // Bool : IsUndefined
                // Если false
                // Byte : Value

                if ( false === Reader.GetBool() )
                {
                    this.Pr.Shd = new CDocumentShd();
                    this.Pr.Shd.Read_FromBinary( Reader );
                }
                else
                    this.Pr.Shd = undefined;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_WidowControl:
            {
                // Bool : IsUndefined

                // Если false
                // Bool : Value

                if ( false === Reader.GetBool() )
                    this.Pr.WidowControl = Reader.GetBool();
                else
                    this.Pr.WidowControl = undefined;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Tabs:
            {
                // Bool : IsUndefined
                // Есди false
                // Variable : CParaTabs

                if ( false === Reader.GetBool() )
                {
                    this.Pr.Tabs = new CParaTabs();
                    this.Pr.Tabs.Read_FromBinary( Reader );
                }
                else
                    this.Pr.Tabs = undefined;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_PStyle:
            {
                // Bool : Удаляем ли

                // Если false
                // String : StyleId

                if ( false === Reader.GetBool() )
                    this.Pr.PStyle = Reader.GetString2();
                else
                    this.Pr.PStyle = undefined;

                this.CompiledPr.NeedRecalc = true;
                this.Recalc_RunsCompiledPr();

                break;
            }

            case historyitem_Paragraph_DocNext:
            {
                // String : Id элемента

                //this.Next = g_oTableId.Get_ById( Reader.GetString2() );

                break;
            }
            case historyitem_Paragraph_DocPrev:
            {
                // String : Id элемента

                //this.Prev = g_oTableId.Get_ById( Reader.GetString2() );

                break;
            }
            case historyitem_Paragraph_Parent:
            {
                // String : Id элемента

                //this.Parent = g_oTableId.Get_ById( Reader.GetString2() );

                break;
            }

            case historyitem_Paragraph_Borders_Between:
            {
                // Bool : IsUndefined
                // если false
                //  Variable : Border (CDocumentBorder)

                if ( false === Reader.GetBool() )
                {
                    this.Pr.Brd.Between = new CDocumentBorder();
                    this.Pr.Brd.Between.Read_FromBinary( Reader );
                }
                else
                    this.Pr.Brd.Between = undefined;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Borders_Bottom:
            {
                // Bool : IsUndefined
                // если false
                //  Variable : Border (CDocumentBorder)

                if ( false === Reader.GetBool() )
                {
                    this.Pr.Brd.Bottom = new CDocumentBorder();
                    this.Pr.Brd.Bottom.Read_FromBinary( Reader );
                }
                else
                    this.Pr.Brd.Bottom = undefined;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Borders_Left:
            {
                // Bool : IsUndefined
                // если false
                //  Variable : Border (CDocumentBorder)

                if ( false === Reader.GetBool() )
                {
                    this.Pr.Brd.Left = new CDocumentBorder();
                    this.Pr.Brd.Left.Read_FromBinary( Reader );
                }
                else
                    this.Pr.Brd.Left = undefined;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Borders_Right:
            {
                // Bool : IsUndefined
                // если false
                //  Variable : Border (CDocumentBorder)

                if ( false === Reader.GetBool() )
                {
                    this.Pr.Brd.Right = new CDocumentBorder();
                    this.Pr.Brd.Right.Read_FromBinary( Reader );
                }
                else
                    this.Pr.Brd.Right = undefined;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Borders_Top:
            {
                // Bool : IsUndefined
                // если false
                //  Variable : Border (CDocumentBorder)

                if ( false === Reader.GetBool() )
                {
                    this.Pr.Brd.Top = new CDocumentBorder();
                    this.Pr.Brd.Top.Read_FromBinary( Reader );
                }
                else
                    this.Pr.Brd.Top = undefined;

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_Pr:
            {
                // Bool : IsUndefined

                if ( true === Reader.GetBool() )
                    this.Pr = new CParaPr();
                else
                {
                    this.Pr = new CParaPr();
                    this.Pr.Read_FromBinary( Reader );
                }

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_PresentationPr_Bullet:
            {
                // Variable : Bullet

                var Bullet = new CBullet();
                Bullet.Read_FromBinary( Reader );
                this.PresentationPr.Bullet = Bullet;
                this.CompiledPr.NeedRecalc = true;
                break;
            }

            case historyitem_Paragraph_PresentationPr_Level:
            {
                // Long : Level
                this.Pr.Lvl = Reader.GetLong();
                this.CompiledPr.NeedRecalc = true;
                this.Recalc_RunsCompiledPr();
                break;
            }

            case historyitem_Paragraph_FramePr:
            {
                // Bool : IsUndefined
                // false ->
                //   Variable : CFramePr

                if ( false === Reader.GetBool() )
                {
                    this.Pr.FramePr = new CFramePr();
                    this.Pr.FramePr.Read_FromBinary( Reader );
                }
                else
                {
                    this.Pr.FramePr = undefined;
                }

                this.CompiledPr.NeedRecalc = true;

                break;
            }

            case historyitem_Paragraph_SectionPr:
            {
                // Bool : IsUndefined
                // false ->
                //   String2 : SectPr.Id

                this.SectPr = ( true === Reader.GetBool() ? undefined : g_oTableId.Get_ById( Reader.GetString2() ) );
                this.LogicDocument.Update_SectionsInfo();

                break;
            }
        }

        this.RecalcInfo.Set_Type_0(pararecalc_0_All);
        this.RecalcInfo.Set_Type_0_Spell(pararecalc_0_Spell_All);
    },

    Write_ToBinary2 : function(Writer)
    {
        Writer.WriteLong( historyitem_type_Paragraph );

        // String2   : Id
        // Variable  : ParaPr
        // String2   : Id TextPr
        // Long      : количество элементов
        // Array of String2 : массив с Id элементами
        // Bool     : bFromDocument

        Writer.WriteString2( "" + this.Id );

        var PrForWrite, TextPrForWrite;
        if(this.StartState)
        {
            PrForWrite = this.StartState.Pr;
            TextPrForWrite = this.StartState.TextPr;
        }
        else
        {
            PrForWrite = this.Pr;
            TextPrForWrite = this.TextPr;
        }

        PrForWrite.Write_ToBinary( Writer );
        Writer.WriteString2( "" + TextPrForWrite.Get_Id() );

        var Count = this.Content.length;
        Writer.WriteLong( Count );

        for ( var Index = 0; Index < Count; Index++ )
        {
            Writer.WriteString2( "" + this.Content[Index].Get_Id() );
        }

        Writer.WriteBool( this.bFromDocument );
    },

    Read_FromBinary2 : function(Reader)
    {
        // String2   : Id
        // Variable  : ParaPr
        // String2   : Id TextPr
        // Long      : количество элементов
        // Array of String2 : массив с Id элементами
        // Bool     : bFromDocument

        this.Id     = Reader.GetString2();

        this.Pr = new CParaPr();
        this.Pr.Read_FromBinary( Reader );
        this.TextPr = g_oTableId.Get_ById( Reader.GetString2() );

        this.Content = [];
        var Count = Reader.GetLong();
        for ( var Index = 0; Index < Count; Index++ )
        {
            var Element = g_oTableId.Get_ById( Reader.GetString2() );

            if ( null != Element )
                this.Content.push( Element );
        }

        CollaborativeEditing.Add_NewObject( this );

        this.bFromDocument = Reader.GetBool();
        if(this.bFromDocument || (editor && editor.WordControl && editor.WordControl.m_oDrawingDocument))
        {
            var DrawingDocument = editor.WordControl.m_oDrawingDocument;
            if ( undefined !== DrawingDocument && null !== DrawingDocument )
            {
                this.DrawingDocument = DrawingDocument;
                this.LogicDocument   = this.bFromDocument ? this.DrawingDocument.m_oLogicDocument : null;
            }
        }
        else
        {
            CollaborativeEditing.Add_LinkData(this, {});
        }
    },

    Load_LinkData : function(LinkData)
    {
        if(this.Parent && this.Parent.Parent && this.Parent.Parent.getDrawingDocument)
        {
            this.DrawingDocument = this.Parent.Parent.getDrawingDocument();
        }
    },

    Clear_CollaborativeMarks : function()
    {
    },

    Get_SelectionState2 : function()
    {
        var ParaState = {};

        ParaState.Id      = this.Get_Id();
        ParaState.CurPos  =
        {
            X          : this.CurPos.X,
            Y          : this.CurPos.Y,
            Line       : this.CurPos.Line,
            ContentPos : this.Get_ParaContentPos( false, false ),
            RealX      : this.CurPos.RealX,
            RealY      : this.CurPos.RealY,
            PagesPos   : this.CurPos.PagesPos
        };

        ParaState.Selection =
        {
            Start    : this.Selection.Start,
            Use      : this.Selection.Use,
            StartPos : 0,
            EndPos   : 0,
            Flag     : this.Selection.Flag
        };

        if ( true === this.Selection.Use )
        {
            ParaState.Selection.StartPos = this.Get_ParaContentPos( true, true );
            ParaState.Selection.EndPos   = this.Get_ParaContentPos( true, false );
        }

        return ParaState;
    },

    Set_SelectionState2 : function(ParaState)
    {
        this.CurPos.X          = ParaState.CurPos.X;
        this.CurPos.Y          = ParaState.CurPos.Y;
        this.CurPos.Line       = ParaState.CurPos.Line;
        this.CurPos.RealX      = ParaState.CurPos.RealX;
        this.CurPos.RealY      = ParaState.CurPos.RealY;
        this.CurPos.PagesPos   = ParaState.CurPos.PagesPos;

        this.Set_ParaContentPos(ParaState.CurPos.ContentPos, true, -1, -1);

        this.Selection_Remove();

        this.Selection.Start = ParaState.Selection.Start;
        this.Selection.Use   = ParaState.Selection.Use;
        this.Selection.Flag  = ParaState.Selection.Flag;

        if ( true === this.Selection.Use )
            this.Set_SelectionContentPos( ParaState.Selection.StartPos, ParaState.Selection.EndPos )
    },
//-----------------------------------------------------------------------------------
// Функции для работы с комментариями
//-----------------------------------------------------------------------------------
    Add_Comment : function(Comment, bStart, bEnd)
    {
        if ( true == this.ApplyToAll )
        {
            if ( true === bEnd )
            {
                var EndContentPos = this.Get_EndPos( false );

                var CommentEnd = new ParaComment( false, Comment.Get_Id() );

                var EndPos = EndContentPos.Get(0);

                // Любые другие элементы мы целиком включаем в комментарий
                if ( para_Run === this.Content[EndPos].Type )
                {
                    var NewElement = this.Content[EndPos].Split( EndContentPos, 1 );

                    if ( null !== NewElement )
                        this.Internal_Content_Add( EndPos + 1, NewElement );
                }

                this.Internal_Content_Add( EndPos + 1, CommentEnd );
            }

            if ( true === bStart )
            {
                var StartContentPos = this.Get_StartPos();

                var CommentStart = new ParaComment( true, Comment.Get_Id() );

                var StartPos = StartContentPos.Get(0);

                // Любые другие элементы мы целиком включаем в комментарий
                if ( para_Run === this.Content[StartPos].Type )
                {
                    var NewElement = this.Content[StartPos].Split( StartContentPos, 1 );

                    if ( null !== NewElement )
                        this.Internal_Content_Add( StartPos + 1, NewElement );

                    this.Internal_Content_Add( StartPos + 1, CommentStart );
                }
                else
                {
                    this.Internal_Content_Add( StartPos, CommentStart );
                }
            }
        }
        else
        {
            if ( true === this.Selection.Use )
            {
                var StartContentPos = this.Get_ParaContentPos( true, true );
                var EndContentPos   = this.Get_ParaContentPos( true, false );

                if ( StartContentPos.Compare( EndContentPos ) > 0 )
                {
                    var Temp = StartContentPos;
                    StartContentPos = EndContentPos;
                    EndContentPos   = Temp;
                }

                if ( true === bEnd )
                {
                    var CommentEnd = new ParaComment( false, Comment.Get_Id() );

                    var EndPos = EndContentPos.Get(0);

                    // Любые другие элементы мы целиком включаем в комментарий
                    if ( para_Run === this.Content[EndPos].Type )
                    {
                        var NewElement = this.Content[EndPos].Split( EndContentPos, 1 );

                        if ( null !== NewElement )
                            this.Internal_Content_Add( EndPos + 1, NewElement );
                    }

                    this.Internal_Content_Add( EndPos + 1, CommentEnd );
                    this.Selection.EndPos = EndPos + 1;
                }

                if ( true === bStart )
                {
                    var CommentStart = new ParaComment( true, Comment.Get_Id() );

                    var StartPos = StartContentPos.Get(0);

                    // Любые другие элементы мы целиком включаем в комментарий
                    if ( para_Run === this.Content[StartPos].Type )
                    {
                        var NewElement = this.Content[StartPos].Split( StartContentPos, 1 );

                        if ( null !== NewElement )
                        {
                            this.Internal_Content_Add( StartPos + 1, NewElement );
                            NewElement.Select_All();
                        }

                        this.Internal_Content_Add( StartPos + 1, CommentStart );
                        this.Selection.StartPos = StartPos + 1;
                    }
                    else
                    {
                        this.Internal_Content_Add( StartPos, CommentStart );
                        this.Selection.StartPos = StartPos;
                    }
                }
            }
            else
            {
                var ContentPos = this.Get_ParaContentPos( false, false );

                if ( true === bEnd )
                {
                    var CommentEnd = new ParaComment( false, Comment.Get_Id() );

                    var EndPos = ContentPos.Get(0);

                    // Любые другие элементы мы целиком включаем в комментарий
                    if ( para_Run === this.Content[EndPos].Type )
                    {
                        var NewElement = this.Content[EndPos].Split( ContentPos, 1 );

                        if ( null !== NewElement )
                            this.Internal_Content_Add( EndPos + 1, NewElement );
                    }

                    this.Internal_Content_Add( EndPos + 1, CommentEnd );
                }

                if ( true === bStart )
                {
                    var CommentStart = new ParaComment( true, Comment.Get_Id() );

                    var StartPos = ContentPos.Get(0);

                    // Любые другие элементы мы целиком включаем в комментарий
                    if ( para_Run === this.Content[StartPos].Type )
                    {
                        var NewElement = this.Content[StartPos].Split( ContentPos, 1 );

                        if ( null !== NewElement )
                            this.Internal_Content_Add( StartPos + 1, NewElement );

                        this.Internal_Content_Add( StartPos + 1, CommentStart );
                    }
                    else
                    {
                        this.Internal_Content_Add( StartPos, CommentStart );
                    }
                }
            }
        }

        this.Correct_Content();
    },

    Add_Comment2 : function(Comment, ObjectId)
    {
        // TODO: Реализовать добавление комментария по ID объекта
//        var Pos = -1;
//        var Count = this.Content.length;
//        for ( var Index = 0; Index < Count; Index++ )
//        {
//            var Item = this.Content[Index];
//            if ( para_Drawing === Item.Type )
//            {
//                Pos = Index;
//                break;
//            }
//        }
//
//        if ( -1 != Pos )
//        {
//            var StartPos = Pos;
//            var EndPos   = Pos + 1;
//
//            var PagePos = this.Internal_GetXYByContentPos( EndPos );
//            var Line    = this.Lines[PagePos.Internal.Line];
//            var LineA   = Line.Metrics.Ascent;
//            var LineH   = Line.Bottom - Line.Top;
//            Comment.Set_EndInfo( PagePos.PageNum, PagePos.X, PagePos.Y - LineA, LineH, this.Get_Id() );
//
//            var Item = new ParaCommentEnd(Comment.Get_Id());
//            this.Internal_Content_Add( EndPos, Item );
//
//            var PagePos = this.Internal_GetXYByContentPos( StartPos );
//            var Line    = this.Lines[PagePos.Internal.Line];
//            var LineA   = Line.Metrics.Ascent;
//            var LineH   = Line.Bottom - Line.Top;
//            Comment.Set_StartInfo( PagePos.PageNum, PagePos.X, PagePos.Y - LineA, LineH, this.XLimit, this.Get_Id() );
//
//            var Item = new ParaCommentStart(Comment.Get_Id());
//            this.Internal_Content_Add( StartPos, Item );
//        }
    },

    CanAdd_Comment : function()
    {
        if ( true === this.Selection.Use && true != this.Selection_IsEmpty() )
            return true;

        return false;
    },

    Remove_CommentMarks : function(Id)
    {
        var Count = this.Content.length;
        for ( var Pos = 0; Pos < Count; Pos++ )
        {
            var Item = this.Content[Pos];
            if ( para_Comment === Item.Type && Id === Item.CommentId )
            {
                this.Internal_Content_Remove( Pos );
                Pos--;
                Count--;
            }
        }
    },

    Replace_MisspelledWord : function(Word, WordId)
    {
        var Element = this.SpellChecker.Elements[WordId];

        // Сначала вставим новое слово
        var Class = Element.StartRun;
        if (para_Run !== Class.Type || Element.StartPos.Data.Depth <= 0)
            return;

        var RunPos = Element.StartPos.Data[Element.StartPos.Depth - 1];
        var Len = Word.length;
        for ( var Pos = 0; Pos < Len; Pos++ )
        {
            Class.Add_ToContent( RunPos + Pos,  ( 0x0020 === Word.charCodeAt(Pos) ? new ParaSpace() : new ParaText(Word[Pos]) ) );
        }

        // Удалим старое слово
        var StartPos = Element.StartPos;
        var EndPos   = Element.EndPos;
        
        // Если комментарии попадают в текст, тогда сначала их надо отдельно удалить
        var CommentsToDelete = {};
        var EPos = EndPos.Get(0);
        var SPos = StartPos.Get(0);
        for (var Pos = SPos; Pos <= EPos; Pos++)
        {
            var Item = this.Content[Pos];
            if (para_Comment === Item.Type)
                CommentsToDelete[Item.CommentId] = true;
        }
        
        for (var CommentId in CommentsToDelete)
        {
            this.LogicDocument.Remove_Comment( CommentId, true, false );
        }

        this.Set_SelectionContentPos( StartPos, EndPos );
        this.Selection.Use  = true;
        this.Selection.Flag = selectionflag_Common;

        this.Remove();

        this.Selection_Remove();
        this.Set_ParaContentPos( StartPos, true, -1, -1 );

        this.RecalcInfo.Set_Type_0( pararecalc_0_All );

        Element.Checked = null;
    },

    Ignore_MisspelledWord : function(WordId)
    {
        var Element = this.SpellChecker.Elements[WordId];
        Element.Checked = true;
        this.ReDraw();
    },

    Get_SectionPr : function()
    {
        return this.SectPr;
    },

    Set_SectionPr : function(SectPr)
    {
        if ( this.LogicDocument !== this.Parent )
            return;
        
        if ( SectPr !== this.SectPr )
        {
            History.Add( this, { Type : historyitem_Paragraph_SectionPr, Old : this.SectPr, New : SectPr } );

            this.SectPr = SectPr;

            this.LogicDocument.Update_SectionsInfo();

            // TODO: Когда избавимся от ParaEnd переделать тут
            var LastRun = this.Content[this.Content.length - 1];
            LastRun.RecalcInfo.Measure = true;
        }
    },

    Get_LastRangeVisibleBounds : function()
    {
        var CurLine = this.Lines.length - 1;
        var CurPage = this.Pages.length - 1;

        var Line = this.Lines[CurLine];
        var RangesCount = Line.Ranges.length;

        var RangeW = new CParagraphRangeVisibleWidth();

        var CurRange = 0;
        for (; CurRange < RangesCount; CurRange++)
        {
            var Range = Line.Ranges[CurRange];
            var StartPos = Range.StartPos;
            var EndPos = Range.EndPos;

            RangeW.W   = 0;
            RangeW.End = false;

            if (true === this.Numbering.Check_Range(CurRange, CurLine))
                RangeW.W += this.Numbering.WidthVisible;

            for (var Pos = StartPos; Pos <= EndPos; Pos++)
            {
                var Item = this.Content[Pos];
                Item.Get_Range_VisibleWidth(RangeW, CurLine, CurRange);
            }

            if ( true === RangeW.End || CurRange === RangesCount - 1 )
                break;
        }

        // Определяем позицию и высоту строки
        var Y = this.Pages[CurPage].Y      + this.Lines[CurLine].Top;
        var H = this.Lines[CurLine].Bottom - this.Lines[CurLine].Top;
        var X = this.Lines[CurLine].Ranges[CurRange].XVisible;
        var W = RangeW.W;
        var B = this.Lines[CurLine].Y      - this.Lines[CurLine].Top;
        var XLimit = this.XLimit - this.Get_CompiledPr2(false).ParaPr.Ind.Right

        return { X : X, Y : Y, W : W, H : H, BaseLine : B, XLimit : XLimit };
    },


    Save_RecalculateObject : function()
    {
        var RecalcObj = new CParagraphRecalculateObject();
        RecalcObj.Save( this );
        return RecalcObj;
    },

    Load_RecalculateObject : function(RecalcObj)
    {
        RecalcObj.Load( this );
    },

    Prepare_RecalculateObject : function()
    {
        this.Pages = [];
        this.Lines = [];

        var Count = this.Content.length;
        for ( var Index = 0; Index < Count; Index++ )
        {
            this.Content[Index].Prepare_RecalculateObject();
        }
    }
};

var pararecalc_0_All  = 0;
var pararecalc_0_None = 1;

var pararecalc_0_Spell_All  = 0;
var pararecalc_0_Spell_Pos  = 1;
var pararecalc_0_Spell_Lang = 2;
var pararecalc_0_Spell_None = 3;

function CParaRecalcInfo()
{
    this.Recalc_0_Type = pararecalc_0_All;
    this.Recalc_0_Spell =
    {
        Type      : pararecalc_0_All,
        StartPos  : 0,
        EndPos    : 0
    };
}

CParaRecalcInfo.prototype =
{
    Set_Type_0 : function(Type)
    {
        this.Recalc_0_Type = Type;
    },

    Set_Type_0_Spell : function(Type, StartPos, EndPos)
    {
        if ( pararecalc_0_Spell_All === this.Recalc_0_Spell.Type )
            return;
        else if ( pararecalc_0_Spell_None === this.Recalc_0_Spell.Type || pararecalc_0_Spell_Lang === this.Recalc_0_Spell.Type )
        {
            this.Recalc_0_Spell.Type = Type;
            if ( pararecalc_0_Spell_Pos === Type )
            {
                this.Recalc_0_Spell.StartPos = StartPos;
                this.Recalc_0_Spell.EndPos   = EndPos;
            }
        }
        else if ( pararecalc_0_Spell_Pos === this.Recalc_0_Spell.Type )
        {
            if ( pararecalc_0_Spell_All === Type )
                this.Recalc_0_Spell.Type = Type;
            else if ( pararecalc_0_Spell_Pos === Type )
            {
                this.Recalc_0_Spell.StartPos = Math.min( StartPos, this.Recalc_0_Spell.StartPos );
                this.Recalc_0_Spell.EndPos   = Math.max( EndPos,   this.Recalc_0_Spell.EndPos   );
            }
        }
    },

    Update_Spell_OnChange : function(Pos, Count, bAdd)
    {
        if ( pararecalc_0_Spell_Pos === this.Recalc_0_Spell.Type )
        {
            if ( true === bAdd )
            {
                if ( this.Recalc_0_Spell.StartPos > Pos )
                    this.Recalc_0_Spell.StartPos++;

                if ( this.Recalc_0_Spell.EndPos >= Pos )
                    this.Recalc_0_Spell.EndPos++;
            }
            else
            {
                if ( this.Recalc_0_Spell.StartPos > Pos )
                {
                    if ( this.Recalc_0_Spell.StartPos > Pos + Count )
                        this.Recalc_0_Spell.StartPos -= Count;
                    else
                        this.Recalc_0_Spell.StartPos = Pos;
                }

                if ( this.Recalc_0_Spell.EndPos >= Pos )
                {
                    if ( this.Recalc_0_Spell.EndPos >= Pos + Count )
                        this.Recalc_0_Spell.EndPos -= Count;
                    else
                        this.Recalc_0_Spell.EndPos = Math.max( 0, Pos - 1 );
                }
            }
        }
    }
};

function CParaLineRange(X, XEnd)
{
    this.X         = X;
    this.XVisible  = 0;
    this.XEnd      = XEnd;

    this.W         = 0;
    this.Words     = 0;
    this.Spaces    = 0;
    this.Letters   = 0;

    this.SpacesSkip  = 0;
    this.LettersSkip = 0;

    this.StartPos  = 0;  // Позиция в контенте параграфа, с которой начинается данный отрезок
    this.EndPos    = 0;  // Позиция в контенте параграфа, на которой заканчиваетсяданный отрезок

    this.SpacePos  = -1; // Позиция, с которой начинаем считать пробелы
}

CParaLineRange.prototype =
{
    Shift : function(Dx, Dy)
    {
        this.X        += Dx;
        this.XEnd     += Dx;
        this.XVisible += Dx;
    },

    Reset_Width : function()
    {
        this.W           = 0;
        this.Words       = 0;
        this.Spaces      = 0;
        this.Letters     = 0;
        this.SpacesSkip  = 0;
        this.LettersSkip = 0;
    },

    Copy : function()
    {
        var NewRange = new CParaLineRange();

        NewRange.X           = this.X;
        NewRange.XVisible    = this.XVisible;
        NewRange.XEnd        = this.XEnd;

        NewRange.W           = this.W;
        NewRange.Words       = this.Words;
        NewRange.Spaces      = this.Spaces;
        NewRange.Letters     = this.Letters;

        NewRange.SpacesSkip  = this.SpacesSkip;
        NewRange.LettersSkip = this.LettersSkip;

        NewRange.StartPos    = this.StartPos;
        NewRange.EndPos      = this.EndPos;

        NewRange.SpacePos    = this.SpacePos;

        return NewRange;
    }
};

function CParaLineMetrics()
{
    this.Ascent      = 0; // Высота над BaseLine
    this.Descent     = 0; // Высота после BaseLine
    this.TextAscent  = 0; // Высота текста над BaseLine
    this.TextAscent2 = 0; // Высота текста над BaseLine
    this.TextDescent = 0; // Высота текста после BaseLine
    this.LineGap     = 0; // Дополнительное расстояние между строками
}

CParaLineMetrics.prototype =
{
    Update : function(TextAscent, TextAscent2, TextDescent, Ascent, Descent, ParaPr)
    {
        if ( TextAscent > this.TextAscent )
            this.TextAscent = TextAscent;

        if ( TextAscent2 > this.TextAscent2 )
            this.TextAscent2 = TextAscent2;

        if ( TextDescent > this.TextDescent )
            this.TextDescent = TextDescent;

        if ( Ascent > this.Ascent )
            this.Ascent = Ascent;

        if ( Descent > this.Descent )
            this.Descent = Descent;

        if ( this.Ascent < this.TextAscent )
            this.Ascent = this.TextAscent;

        if ( this.Descent < this.TextDescent )
            this.Descent = this.TextDescent;

        this.LineGap = this.Recalculate_LineGap( ParaPr, this.TextAscent, this.TextDescent );
    },

    Recalculate_LineGap : function(ParaPr, TextAscent, TextDescent)
    {
        var LineGap = 0;
        switch ( ParaPr.Spacing.LineRule )
        {
            case linerule_Auto:
            {
                LineGap = ( TextAscent + TextDescent ) * ( ParaPr.Spacing.Line - 1 );
                break;
            }
            case linerule_Exact:
            {
                var ExactValue = Math.max( 25.4 / 72, ParaPr.Spacing.Line );
                LineGap = ExactValue - ( TextAscent + TextDescent );

                var Gap = this.Ascent + this.Descent - ExactValue;

                if ( Gap > 0 )
                {
                    var DescentDiff = this.Descent - this.TextDescent;

                    if ( DescentDiff > 0 )
                    {
                        if ( DescentDiff < Gap )
                        {
                            this.Descent = this.TextDescent;
                            Gap -= DescentDiff;
                        }
                        else
                        {
                            this.Descent -= Gap;
                            Gap = 0;
                        }
                    }

                    var AscentDiff = this.Ascent - this.TextAscent;

                    if ( AscentDiff > 0 )
                    {
                        if ( AscentDiff < Gap )
                        {
                            this.Ascent = this.TextAscent;
                            Gap -= AscentDiff;
                        }
                        else
                        {
                            this.Ascent -= Gap;
                            Gap = 0;
                        }
                    }

                    if ( Gap > 0 )
                    {
                        // Уменьшаем пропорционально TextAscent и TextDescent
                        var OldTA = this.TextAscent;
                        var OldTD = this.TextDescent;

                        var Sum = OldTA + OldTD;

                        this.Ascent  = OldTA * (Sum - Gap) / Sum;
                        this.Descent = OldTD * (Sum - Gap) / Sum;
                    }
                }
                else
                {
                    this.Ascent -= Gap; // все в Ascent
                }

                LineGap = 0;


                break;
            }
            case linerule_AtLeast:
            {
                var LineGap1 = ParaPr.Spacing.Line;
                var LineGap2 = TextAscent + TextDescent;
                
                // Специальный случай, когда в строке нет никакого текста
                if ( Math.abs( LineGap2 ) < 0.001 )
                    LineGap = 0;
                else
                    LineGap = Math.max( LineGap1, LineGap2 ) - ( TextAscent + TextDescent );
                
                break;
            }

        }
        return LineGap;
    }
}

function CParaLine(StartPos)
{
    this.Y         = 0; //
    this.W         = 0;
    this.Top       = 0;
    this.Bottom    = 0;
    this.Words     = 0;
    this.Spaces    = 0; // Количество пробелов между словами в строке (пробелы, идущие в конце строки, не учитываются)
    this.Metrics   = new CParaLineMetrics();
    this.Ranges    = []; // Массив CParaLineRanges
    this.RangeY    = false;
    this.StartPos  = StartPos; // Позиция в контенте параграфа, с которой начинается данная строка
    this.EndPos    = StartPos; // Позиция последнего элемента в данной строке
    
    this.LineInfo  = 0;        // Побитовая информация о строке:
                               // 1 бит : есть ли PageBreak в строке
                               // 2 бит : пустая ли строка (без учета PageBreak)
                               // 3 бит : последняя ли это строка (т.е. строка с ParaEnd)
}

CParaLine.prototype =
{
    Add_Range : function(X, XEnd)
    {
        this.Ranges.push( new CParaLineRange( X, XEnd ) );
    },

    Shift : function(Dx, Dy)
    {
        var RangesCount = this.Ranges.length;
        for ( var Index = 0; Index < RangesCount; Index++ )
        {
            this.Ranges[Index].Shift( Dx, Dy );
        }
    },

    Set_RangeStartPos : function(CurRange, StartPos)
    {
        if ( 0 === CurRange )
            this.StartPos = StartPos;

        this.Ranges[CurRange].StartPos = StartPos;
    },

    Set_RangeEndPos : function(CurRange, EndPos)
    {
        this.Ranges[CurRange].EndPos = EndPos;

        if ( CurRange === this.Ranges.length - 1 )
            this.Set_EndPos( EndPos );
    },

    Copy : function()
    {
        var NewLine = new CParaLine();

        NewLine.Y      = this.Y;
        NewLine.W      = this.W;
        NewLine.Top    = this.Top;
        NewLine.Bottom = this.Bottom;
        NewLine.Words  = this.Words;
        NewLine.Spaces = this.Spaces;


        NewLine.Metrics.Ascent      = this.Ascent;
        NewLine.Metrics.Descent     = this.Descent;
        NewLine.Metrics.TextAscent  = this.TextAscent;
        NewLine.Metrics.TextAscent2 = this.TextAscent2;
        NewLine.Metrics.TextDescent = this.TextDescent;
        NewLine.Metrics.LineGap     = this.LineGap;

        var Count = this.Ranges.length;
        for ( var Index = 0; Index < Count; Index++ )
        {
            NewLine.Ranges[Index] = this.Ranges[Index].Copy();
        }

        NewLine.RangeY   = this.RangeY;
        NewLine.StartPos = this.StartPos;
        NewLine.EndPos   = this.EndPos;

        return NewLine;
    },

    Reset : function(StartPos)
    {
        //this.Y        = 0; //
        this.Top      = 0;
        this.Bottom   = 0;
        this.Words    = 0;
        this.Spaces   = 0; // Количество пробелов между словами в строке (пробелы, идущие в конце строки, не учитываются)
        this.Metrics  = new CParaLineMetrics();
        this.Ranges   = []; // Массив CParaLineRanges
        //this.RangeY   = false;
        this.StartPos = StartPos;
    },

    Set_EndPos : function(EndPos, Paragraph)
    {
        this.EndPos = EndPos;        
    }
};

function CDocumentBounds(Left, Top, Right, Bottom)
{
    this.Bottom = Bottom;
    this.Left   = Left;
    this.Right  = Right;
    this.Top    = Top;
}

CDocumentBounds.prototype =
{
    Shift : function(Dx, Dy)
    {
        this.Bottom += Dy;
        this.Top    += Dy;
        this.Left   += Dx;
        this.Right  += Dx;
    }
};

function CParagraphPageEndInfo()
{
    this.Comments = []; // Массив незакрытых комментариев на данной странице (комментарии, которые были
    // открыты до данной страницы и не закрыты на этой тут тоже присутствуют)

    this.RunRecalcInfo = null;
}

CParagraphPageEndInfo.prototype =
{
    Copy : function()
    {
        var NewPageEndInfo = new CParagraphPageEndInfo();

        var CommentsCount = this.Comments.length;
        for ( var Index = 0; Index < CommentsCount; Index++ )
        {
            NewPageEndInfo.Comments.push( this.Comments[Index] );
        }

        return NewPageEndInfo;
    }
};

function CParaPage(X, Y, XLimit, YLimit, FirstLine)
{
    this.X         = X;
    this.Y         = Y;
    this.XLimit    = XLimit;
    this.YLimit    = YLimit;
    this.FirstLine = FirstLine;
    this.Bounds    = new CDocumentBounds( X, Y, XLimit, Y );
    this.StartLine = FirstLine; // Номер строки, с которой начинается данная страница
    this.EndLine   = FirstLine; // Номер последней строки на данной странице
    this.TextPr    = null;      // Расситанные текстовые настройки для начала страницы

    this.Drawings  = [];
    this.EndInfo   = new CParagraphPageEndInfo();
}

CParaPage.prototype =
{
    Reset : function(X, Y, XLimit, YLimit, FirstLine)
    {
        this.X         = X;
        this.Y         = Y;
        this.XLimit    = XLimit;
        this.YLimit    = YLimit;
        this.FirstLine = FirstLine;
        this.Bounds    = new CDocumentBounds( X, Y, XLimit, Y );
        this.StartLine = FirstLine;
        this.Drawings  = [];
    },

    Shift : function(Dx, Dy)
    {
        this.X      += Dx;
        this.Y      += Dy;
        this.XLimit += Dx;
        this.YLimit += Dy;
        this.Bounds.Shift( Dx, Dy );
    },

    Set_EndLine : function(EndLine)
    {
        this.EndLine = EndLine;
    },

    Add_Drawing : function(Item)
    {
        this.Drawings.push(Item);
    },

    Copy : function()
    {
        var NewPage = new CParaPage();

        NewPage.X             = this.X;
        NewPage.Y             = this.Y;
        NewPage.XLimit        = this.XLimit;
        NewPage.YLimit        = this.YLimit;
        NewPage.FirstLine     = this.FirstLine;

        NewPage.Bounds.Left   = this.Bounds.Left;
        NewPage.Bounds.Right  = this.Bounds.Right;
        NewPage.Bounds.Top    = this.Bounds.Top;
        NewPage.Bounds.Bottom = this.Bounds.Bottom;

        NewPage.StartLine     = this.StartLine;
        NewPage.EndLine       = this.EndLine;

        var Count = this.Drawings.length;
        for ( var Index = 0; Index < Count; Index++ )
        {
            NewPage.Drawings.push( this.Drawings[Index] );
        }

        NewPage.EndInfo = this.EndInfo.Copy();

        return NewPage;
    }
};

function CParaPos(Range, Line, Page, Pos)
{
    this.Range = Range; // Номер промежутка в строке
    this.Line  = Line;  // Номер строки
    this.Page  = Page;  // Номер страницы
    this.Pos   = Pos;   // Позиция в общем массиве
}


// используется в Internal_Draw_3 и Internal_Draw_5
function CParaDrawingRangeLinesElement(y0, y1, x0, x1, w, r, g, b, Additional)
{
    this.y0 = y0;
    this.y1 = y1;
    this.x0 = x0;
    this.x1 = x1;
    this.w  = w;
    this.r  = r;
    this.g  = g;
    this.b  = b;

    this.Additional = Additional;
}


function CParaDrawingRangeLines()
{
    this.Elements = [];
}

CParaDrawingRangeLines.prototype =
{
    Clear : function()
    {
        this.Elements = [];
    },

    Add : function (y0, y1, x0, x1, w, r, g, b, Additional)
    {
        this.Elements.push( new CParaDrawingRangeLinesElement(y0, y1, x0, x1, w, r, g, b, Additional) );
    },

    Get_Next : function()
    {
        var Count = this.Elements.length;
        if ( Count <= 0 )
            return null;

        // Соединяем, начиная с конца, чтобы проще было обрезать массив
        var Element = this.Elements[Count - 1];
        Count--;

        while ( Count > 0 )
        {
            var PrevEl = this.Elements[Count - 1];

            if ( Math.abs( PrevEl.y0 - Element.y0 ) < 0.001 && Math.abs( PrevEl.y1 - Element.y1 ) < 0.001 && Math.abs( PrevEl.x1 - Element.x0 ) < 0.001 && Math.abs( PrevEl.w - Element.w ) < 0.001 && PrevEl.r === Element.r && PrevEl.g === Element.g && PrevEl.b === Element.b
                && ( (undefined === PrevEl.Additional && undefined === Element.Additional) || ( undefined !== PrevEl.Additional && undefined !== Element.Additional && PrevEl.Additional.Active === Element.Additional.Active ) ) )
            {
                Element.x0 = PrevEl.x0;
                Count--;
            }
            else
                break;
        }

        this.Elements.length = Count;

        return Element;
    },

    Correct_w_ForUnderline : function()
    {
        var Count = this.Elements.length;
        if ( Count <= 0 )
            return;

        var CurElements = [];
        for ( var Index = 0; Index < Count; Index++ )
        {
            var Element = this.Elements[Index];
            var CurCount = CurElements.length;

            if ( 0 === CurCount )
                CurElements.push( Element );
            else
            {
                var PrevEl = CurElements[CurCount - 1];

                if ( Math.abs( PrevEl.y0 - Element.y0 ) < 0.001 && Math.abs( PrevEl.y1 - Element.y1 ) < 0.001 && Math.abs( PrevEl.x1 - Element.x0 ) < 0.001 )
                {
                    // Сравниваем толщины линий
                    if ( Element.w > PrevEl.w )
                    {
                        for ( var Index2 = 0; Index2 < CurCount; Index2++ )
                            CurElements[Index2].w = Element.w;
                    }
                    else
                        Element.w = PrevEl.w;

                    CurElements.push( Element );
                }
                else
                {
                    CurElements.length = 0;
                    CurElements.push( Element );
                }
            }
        }
    }

};

function CParagraphSelection()
{
    this.Start     = false;
    this.Use       = false;
    this.StartPos  = 0;
    this.EndPos    = 0;
    this.Flag      = selectionflag_Common;
    
    this.StartManually = true; // true - через Selection_SetStart, false - через Selection_SetBegEnd
    this.EndManually   = true; // true - через Selection_SetEnd, афдыу - через Selection_SetBegEnd  
}

CParagraphSelection.prototype =
{
    Set_StartPos : function(Pos1, Pos2)
    {
        this.StartPos  = Pos1;
    },

    Set_EndPos : function(Pos1, Pos2)
    {
        this.EndPos  = Pos1;
    }
};

function CParagraphRecalculateTabInfo()
{
    this.TabPos =  0;
    this.X      =  0;
    this.Value  = -1;
    this.Item   = null;
}

CParagraphRecalculateTabInfo.prototype =
{
    Reset : function()
    {
        this.TabPos =  0;
        this.X      =  0;
        this.Value  = -1;
        this.Item   = null;
    }
};

function CParagraphContentPos()
{
    this.Data  = [0, 0, 0];
    this.Depth = 0;
    this.bPlaceholder = false;
}

CParagraphContentPos.prototype =
{
    Add : function (Pos)
    {
        this.Data[this.Depth] = Pos;
        this.Depth++;
    },

    Update : function(Pos, Depth)
    {
        this.Data[Depth] = Pos;
        this.Depth = Depth + 1;
    },

    Update2 : function(Pos, Depth)
    {
        this.Data[Depth] = Pos;
    },

    Set : function(OtherPos)
    {
        // Копируем позицию
        var Len = OtherPos.Depth;
        for ( var Pos = 0; Pos < Len; Pos++ )
            this.Data[Pos] = OtherPos.Data[Pos];

        this.Depth = OtherPos.Depth;

        if ( this.Data.length > this.Depth )
            this.Data.length = this.Depth;
    },

    Get : function(Depth)
    {
        return this.Data[Depth];
    },

    Get_Depth : function()
    {
        return this.Depth - 1;
    },

    Copy : function ()
    {
        var PRPos = new CParagraphContentPos();

        var Count = this.Data.length;
        for (var Index = 0; Index < Count; Index++)
        {
            PRPos.Add( this.Data[Index] );
        }

        return PRPos;
    },

    Compare : function(Pos)
    {
        var CurDepth = 0;

        var Len1 = this.Data.length;
        var Len2 = Pos.Data.length;
        var LenMin = Math.min( Len1, Len2 );

        while ( CurDepth < LenMin )
        {
            if ( this.Data[CurDepth] === Pos.Data[CurDepth] )
            {
                // Если попали в один и тот же элемент, тогда проверяем далее
                CurDepth++;
                continue;
            }
            else if ( this.Data[CurDepth] > Pos.Data[CurDepth] )
                return 1;
            else //if ( this.Data[CurDepth] < Pos.Data[CurDepth] )
                return -1;
        }

        // Такого не должно быть, но на всякий случай пошлем, что позиции не совпадают
        if ( Len1 !== Len2 )
            return -1;

        return 0;
    }
};

function CParagraphRecalculateStateWrap()
{
    this.Paragraph       = undefined;

    this.Page            = 0;
    this.Line            = 0;
    this.Range           = 0;

    this.Ranges          = [];
    this.RangesCount     = 0;

    this.FirstItemOnLine = true;
    this.EmptyLine       = true;
    this.StartWord       = false;
    this.Word            = false;
    this.AddNumbering    = true;

    this.BreakPageLine   = false;
    this.UseFirstLine    = false;

    this.ExtendBoundToBottom = false;

    this.WordLen         = 0;
    this.SpaceLen        = 0;
    this.SpacesCount     = 0;
    this.LastTab         = new CParagraphRecalculateTabInfo();

    this.LineTextAscent  = 0;
    this.LineTextDescent = 0;
    this.LineTextAscent2 = 0;
    this.LineAscent      = 0;
    this.LineDescent     = 0;

    this.X      = 0; // Текущее положение по горизонтали
    this.XEnd   = 0; // Предельное значение по горизонтали для текущего отрезка

    this.Y      = 0; // Текущее положение по вертикали

    this.XStart = 0; // Начальное значение для X на данной страницы
    this.YStart = 0; // Начальное значение для Y на данной страницы
    this.XLimit = 0; // Предельное значение для X на данной страницы
    this.YLimit = 0; // Предельное значение для Y на данной страницы

    this.NewPage  = false; // Переходим на новую страницу
    this.NewRange = false; // Переходим к новому отрезку
    this.End      = false;
    this.RangeY   = false; // Текущая строка переносится по Y из-за обтекания

    this.CurPos       = new CParagraphContentPos();

    this.NumberingPos = new CParagraphContentPos(); // Позиция элемента вместе с которым идет нумерация

    this.MoveToLBP    = false;                      // Делаем ли разрыв в позиции this.LineBreakPos
    this.LineBreakPos = new CParagraphContentPos(); // Последняя позиция в которой можно будет добавить разрыв
    // отрезка или строки, если что-то не умещается (например,
    // если у нас не убирается слово, то разрыв ставим перед ним)

    this.PageBreak     = null;      // Текущий PageBreak
    this.SkipPageBreak = false;     // Нужно ли пропускать PageBreak

    this.RunRecalcInfoLast  = null; // RecalcInfo последнего рана
    this.RunRecalcInfoBreak = null; // RecalcInfo рана, на котором произошел разрыв отрезка/строки

    this.RecalcResult = 0x00;//recalcresult_NextElement;
}

CParagraphRecalculateStateWrap.prototype =
{
    // Обнуляем некоторые параметры перед новой строкой
    Reset_Line : function()
    {
        this.RecalcResult        = recalcresult_NextLine;

        this.EmptyLine           = true;
        this.BreakPageLine       = false;
        this.End                 = false;
        this.UseFirstLine        = false;

        this.LineTextAscent      = 0;
        this.LineTextAscent2     = 0;
        this.LineTextDescent     = 0;
        this.LineAscent          = 0;
        this.LineDescent         = 0;

        this.NewPage             = false;
        this.ForceNewPage        = false;
    },

    // Обнуляем некоторые параметры перед новым отрезком
    Reset_Range : function(X, XEnd)
    {
        this.LastTab.Reset();

        this.SpaceLen        = 0;
        this.WordLen         = 0;
        this.SpacesCount     = 0;
        this.Word            = false;
        this.FirstItemOnLine = true;
        this.StartWord       = false;
        this.NewRange        = false;
        this.X               = X;
        this.XEnd            = XEnd;

        this.MoveToLBP    = false;
        this.LineBreakPos = new CParagraphContentPos();
    },

    Set_LineBreakPos : function(PosObj)
    {
        this.LineBreakPos.Set( this.CurPos );
        this.LineBreakPos.Add( PosObj );
    },

    Set_NumberingPos : function(PosObj, Item)
    {
        this.NumberingPos.Set( this.CurPos );
        this.NumberingPos.Add( PosObj );

        this.Paragraph.Numbering.Pos  = this.NumberingPos;
        this.Paragraph.Numbering.Item = Item;
    },

    Update_CurPos : function(PosObj, Depth)
    {
        this.CurPos.Update(PosObj, Depth);
    },

    Reset_Ranges : function()
    {
        this.Ranges      = [];
        this.RangesCount = 0;
    },

    Reset_PageBreak : function()
    {
        this.PageBreak           = null;
        this.SkipPageBreak       = false;
        this.ExtendBoundToBottom = false;
    },

    Reset_RunRecalcInfo : function()
    {
        this.RunRecalcInfoBreak = this.RunRecalcInfoLast;
    },

    Restore_RunRecalcInfo : function()
    {
        this.RunRecalcInfoLast = this.RunRecalcInfoBreak;
    }
};

function CParagraphRecalculateStateCounter()
{
    this.Paragraph   = undefined;
    this.Range       = undefined;
    this.Word        = false;
    this.SpaceLen    = 0;
    this.SpacesCount = 0;
}

CParagraphRecalculateStateCounter.prototype =
{
    Reset : function(Paragraph, Range)
    {
        this.Paragraph   = Paragraph;
        this.Range       = Range;
        this.Word        = false;
        this.SpaceLen    = 0;
        this.SpacesCount = 0;
    }
};

function CParagraphRecalculateStateAlign()
{
    this.X             = 0; // Текущая позиция по горизонтали
    this.Y             = 0; // Текущая позиция по вертикали
    this.XEnd          = 0; // Предельная позиция по горизонтали
    this.JustifyWord   = 0; // Добавочная ширина символов
    this.JustifySpace  = 0; // Добавочная ширина пробелов
    this.SpacesCounter = 0; // Счетчик пробелов с добавочной шириной (чтобы пробелы в конце строки не трогать)
    this.SpacesSkip    = 0; // Количество пробелов, которые мы пропускаем в начале строки
    this.LettersSkip   = 0; // Количество букв, которые мы пропускаем (из-за таба)
    this.LastW         = 0; // Ширина последнего элемента (необходимо для позиционирования картинки)
    this.Paragraph     = undefined;
    this.RecalcResult  = 0x00;//recalcresult_NextElement;

    this.RecalcFast    = false; // Если пересчет быстрый, тогда все "плавающие" объекты мы не трогаем
}

function CParagraphRecalculateStateInfo()
{
    this.Comments = [];
}

CParagraphRecalculateStateInfo.prototype =
{
    Reset : function(PrevInfo)
    {
        if ( null !== PrevInfo && undefined !== PrevInfo )
        {
            this.Comments = PrevInfo.Comments;
        }
        else
        {
            this.Comments = [];
        }
    },

    Add_Comment : function(Id)
    {
        this.Comments.push( Id );
    },

    Remove_Comment : function(Id)
    {
        var CommentsLen = this.Comments.length;
        for (var CurPos = 0; CurPos < CommentsLen; CurPos++)
        {
            if ( this.Comments[CurPos] === Id )
            {
                this.Comments.splice( CurPos, 1 );
                break;
            }
        }
    }
}


//var g_oPRSW = new CParagraphRecalculateStateWrap();
//var g_oPRSC = new CParagraphRecalculateStateCounter();
//var g_oPRSA = new CParagraphRecalculateStateAlign();
//var g_oPRSI = new CParagraphRecalculateStateInfo();

function CParagraphDrawStateHightlights()
{
    this.Page   = 0;
    this.Line   = 0;
    this.Range  = 0;

    this.CurPos = new CParagraphContentPos();

    this.DrawColl = false;

    this.High   = new CParaDrawingRangeLines();
    this.Coll   = new CParaDrawingRangeLines();
    this.Find   = new CParaDrawingRangeLines();
    this.Comm   = new CParaDrawingRangeLines();
    this.Shd    = new CParaDrawingRangeLines();

    this.Comments     = [];
    this.CommentsFlag = comments_NoComment;

    this.SearchCounter = 0;

    this.Paragraph = undefined;
    this.Graphics  = undefined;

    this.X  = 0;
    this.Y0 = 0;
    this.Y1 = 0;

    this.Spaces = 0;
}

CParagraphDrawStateHightlights.prototype =
{
    Reset : function(Paragraph, Graphics, DrawColl, DrawFind, DrawComm, PageEndInfo)
    {
        this.Paragraph = Paragraph;
        this.Graphics  = Graphics;

        this.DrawColl = DrawColl;
        this.DrawFind = DrawFind;

        this.CurPos = new CParagraphContentPos();

        this.SearchCounter = 0;

        if ( null !== PageEndInfo )
            this.Comments = PageEndInfo.Comments;
        else
            this.Comments = [];

        this.Check_CommentsFlag();
    },

    Reset_Range : function(Page, Line, Range, X, Y0, Y1, SpacesCount)
    {
        this.Page  = Page;
        this.Line  = Line;
        this.Range = Range;

        this.High.Clear();
        this.Coll.Clear();
        this.Find.Clear();
        this.Comm.Clear();

        this.X  = X;
        this.Y0 = Y0;
        this.Y1 = Y1;

        this.Spaces = SpacesCount;
    },

    Add_Comment : function(Id)
    {
        this.Comments.push( Id );

        this.Check_CommentsFlag();
    },

    Remove_Comment : function(Id)
    {
        var CommentsLen = this.Comments.length;
        for (var CurPos = 0; CurPos < CommentsLen; CurPos++)
        {
            if ( this.Comments[CurPos] === Id )
            {
                this.Comments.splice( CurPos, 1 );
                break;
            }
        }

        this.Check_CommentsFlag();
    },

    Check_CommentsFlag : function()
    {
        // Проверяем флаг
        var Para = this.Paragraph;
        var DocumentComments = Para.LogicDocument.Comments;
        var CurComment = DocumentComments.Get_CurrentId();
        var CommLen = this.Comments.length;

        // Сначала проверим есть ли вообще комментарии
        this.CommentsFlag = ( CommLen > 0 ? comments_NonActiveComment : comments_NoComment );

        // Проверим является ли какой-либо комментарий активным
        for ( var CurPos = 0; CurPos < CommLen; CurPos++ )
        {
            if ( CurComment === this.Comments[CurPos] )
            {
                this.CommentsFlag = comments_ActiveComment;
                break
            }
        }
    }
};

function CParagraphDrawStateElements()
{
    this.Paragraph = undefined;
    this.Graphics  = undefined;
    this.BgColor   = undefined;

    this.Theme     = undefined;
    this.ColorMap  = undefined;

    this.CurPos = new CParagraphContentPos();

    this.VisitedHyperlink = false;

    this.Page   = 0;
    this.Line   = 0;
    this.Range  = 0;

    this.X = 0;
    this.Y = 0;
}

CParagraphDrawStateElements.prototype =
{
    Reset : function(Paragraph, Graphics, BgColor, Theme, ColorMap)
    {
        this.Paragraph = Paragraph;
        this.Graphics  = Graphics;
        this.BgColor   = BgColor;
        this.Theme     = Theme;
        this.ColorMap  = ColorMap;

        this.VisitedHyperlink = false;

        this.CurPos = new CParagraphContentPos();
    },

    Reset_Range : function(Page, Line, Range, X, Y)
    {
        this.Page  = Page;
        this.Line  = Line;
        this.Range = Range;

        this.X = X;
        this.Y = Y;
    }
};

function CParagraphDrawStateLines()
{
    this.Paragraph = undefined;
    this.Graphics  = undefined;
    this.BgColor   = undefined;

    this.CurPos = new CParagraphContentPos();

    this.VisitedHyperlink = false;

    this.Strikeout  = new CParaDrawingRangeLines();
    this.DStrikeout = new CParaDrawingRangeLines();
    this.Underline  = new CParaDrawingRangeLines();
    this.Spelling   = new CParaDrawingRangeLines();

    this.SpellingCounter = 0;

    this.Page  = 0;
    this.Line  = 0;
    this.Range = 0;

    this.X               = 0;
    this.BaseLine        = 0;
    this.UnderlineOffset = 0;
    this.Spaces          = 0;
}

CParagraphDrawStateLines.prototype =
{
    Reset : function(Paragraph, Graphics, BgColor)
    {
        this.Paragraph = Paragraph;
        this.Graphics  = Graphics;
        this.BgColor   = BgColor;

        this.VisitedHyperlink = false;

        this.CurPos = new CParagraphContentPos();

        this.SpellingCounter = 0;
    },

    Reset_Line : function(Page, Line, Baseline, UnderlineOffset)
    {
        this.Page  = Page;
        this.Line  = Line;

        this.Baseline        = Baseline;
        this.UnderlineOffset = UnderlineOffset;

        this.Strikeout.Clear();
        this.DStrikeout.Clear();
        this.Underline.Clear();
        this.Spelling.Clear();
    },

    Reset_Range : function(Range, X, Spaces)
    {
        this.Range  = Range;
        this.X      = X;
        this.Spaces = Spaces;
    }
};

var g_oPDSH = new CParagraphDrawStateHightlights();
//var g_oPDSE = new CParagraphDrawStateElements();
var g_oPDSL = new CParagraphDrawStateLines();

//----------------------------------------------------------------------------------------------------------------------
// Классы для работы с курсором
//----------------------------------------------------------------------------------------------------------------------

// Общий класс для нахождения позиции курсора слева/справа/начала и конца слова и т.д.
function CParagraphSearchPos()
{
    this.Pos   = new CParagraphContentPos(); // Искомая позиция
    this.Found = false;                      // Нашли или нет

    this.Line  = -1;
    this.Range = -1;

    this.Stage       = 0; // Номера этапов для поиска начала и конца слова
    this.Shift       = false;
    this.Punctuation = false;
    this.First       = true;
    this.UpdatePos   = false;
    
    this.ForSelection = false;
}

function CParagraphSearchPosXY()
{
    this.Pos       = new CParagraphContentPos();
    this.InTextPos = new CParagraphContentPos();

    this.CurX           = 0;
    this.CurY           = 0;
    this.X              = 0;
    this.DiffX          = 1000000; // километра для ограничения должно хватить
    this.NumberingDiffX = 1000000; // километра для ограничения должно хватить

    this.Line      = 0;
    this.Range     = 0;

    this.InText    = false;
    this.Numbering = false;
    this.End       = false;
}

//----------------------------------------------------------------------------------------------------------------------
// Классы для работы с селектом
//----------------------------------------------------------------------------------------------------------------------
function CParagraphDrawSelectionRange()
{
    this.StartX    = 0;
    this.W         = 0;

    this.StartY    = 0;
    this.H         = 0;

    this.FindStart = true;
}

//----------------------------------------------------------------------------------------------------------------------
//
//----------------------------------------------------------------------------------------------------------------------
function CParagraphCheckPageBreakEnd(PageBreak)
{
    this.PageBreak = PageBreak;
    this.FindPB    = true;
}

function CParagraphGetText()
{
    this.Text = "";
}

function CParagraphNearPos()
{
    this.NearPos = null;
    this.Classes = [];
}

function CParagraphElementNearPos()
{
    this.NearPos = null;
    this.Depth   = 0;
}

function CParagraphDrawingLayout(Drawing, Paragraph, X, Y, Line, Range, Page)
{
    this.Paragraph = Paragraph;
    this.Drawing   = Drawing;
    this.Line      = Line;
    this.Range     = Range;
    this.Page      = Page;
    this.X         = X;
    this.Y         = Y;
    this.LastW     = 0;

    this.Layout    = null;
    this.Limits    = null;
}

function CParagraphGetDropCapText()
{
    this.Runs  = [];
    this.Text  = [];
    this.Mixed = false;
    this.Check = true;
}

//----------------------------------------------------------------------------------------------------------------------
//
//----------------------------------------------------------------------------------------------------------------------

function CRunRecalculateObject(StartLine, StartRange)
{
    this.StartLine   = StartLine;
    this.StartRange  = StartRange

    this.Lines       = [];

    this.Content = [];
}


CRunRecalculateObject.prototype =
{
    Save_Lines : function(Obj, Copy)
    {
        if ( true === Copy )
        {
            var Lines = Obj.Lines;
            var Count = Obj.Lines.length;
            for ( var Index = 0; Index < Count; Index++ )
                this.Lines[Index] = Lines[Index];
        }
        else
        {
            this.Lines = Obj.Lines;
        }
    },

    Save_Content : function(Obj, Copy)
    {
        var Content = Obj.Content;
        var ContentLen = Content.length;
        for ( var Index = 0; Index < ContentLen; Index++ )
        {
            this.Content[Index] = Content[Index].Save_RecalculateObject(Copy);
        }
    },

    Load_Lines : function(Obj)
    {
        Obj.StartLine  = this.StartLine;
        Obj.StartRange = this.StartRange;
        Obj.Lines      = this.Lines;
    },

    Load_Content : function(Obj)
    {
        var Count = Obj.Content.length;
        for ( var Index = 0; Index < Count; Index++ )
        {
            Obj.Content[Index].Load_RecalculateObject( this.Content[Index] );
        }
    },

    Save_RunContent : function(Run, Copy)
    {
        var ContentLen = Run.Content.length;
        for ( var Index = 0, Index2 = 0; Index < ContentLen; Index++ )
        {
            var Item = Run.Content[Index];

            if ( para_PageNum === Item.Type || para_Drawing === Item.Type )
                this.Content[Index2++] = Item.Save_RecalculateObject(Copy);
        }
    },

    Load_RunContent : function(Run)
    {
        var Count = Run.Content.length;
        for ( var Index = 0, Index2 = 0; Index < Count; Index++ )
        {
            var Item = Run.Content[Index];

            if ( para_PageNum === Item.Type || para_Drawing === Item.Type )
                Item.Load_RecalculateObject( this.Content[Index2++] );
        }
    },

    Get_DrawingFlowPos : function(FlowPos)
    {
        var Count = this.Content.length;
        for ( var Index = 0, Index2 = 0; Index < Count; Index++ )
        {
            var Item = this.Content[Index];

            if ( para_Drawing === Item.Type && undefined !== Item.FlowPos )
                FlowPos.push( Item.FlowPos );
        }
    },

    Compare : function(_CurLine, _CurRange, OtherLinesInfo)
    {
        var OLI = OtherLinesInfo;

        var CurLine = _CurLine - this.StartLine;
        var CurRange = ( 0 === CurLine ? _CurRange - this.StartRange : _CurRange );

        // Специальная заглушка для элементов типа комментария
        if ( ( 0 === this.Lines.length || 0 === this.LinesLength ) && ( 0 === OLI.Lines.length || 0 === OLI.LinesLength ) )
            return true;

        if ( this.StartLine !== OLI.StartLine || this.StartRange !== OLI.StartRange || CurLine < 0 || CurLine >= this.private_Get_LinesCount() || CurLine >= OLI.protected_GetLinesCount() || CurRange < 0 || CurRange >= this.private_Get_RangesCount(CurLine) || CurRange >= OLI.protected_GetRangesCount(CurLine) )
            return false;

        var ThisSP = this.private_Get_RangeStartPos(CurLine, CurRange);
        var ThisEP = this.private_Get_RangeEndPos(CurLine, CurRange);

        var OtherSP = OLI.protected_GetRangeStartPos(CurLine, CurRange);
        var OtherEP = OLI.protected_GetRangeEndPos(CurLine, CurRange);

        if ( ThisSP !== OtherSP || ThisEP !== OtherEP )
            return false;

        if ( ( (OLI.Content === undefined || para_Run === OLI.Type) && this.Content.length > 0 ) || ( OLI.Content !== undefined && para_Run !== OLI.Type && OLI.Content.length !== this.Content.length) )
            return false;

        var ContentLen = this.Content.length;
        var StartPos = ThisSP;
        var EndPos   = Math.min( ContentLen - 1, ThisEP );

        for ( var CurPos = StartPos; CurPos <= EndPos; CurPos++ )
        {
            if ( false === this.Content[CurPos].Compare( _CurLine, _CurRange, OLI.Content[CurPos] ) )
                return false;
        }

        return true;
    },
    
    private_Get_RangeOffset : function(LineIndex, RangeIndex)
    {
        return (1 + this.Lines[0] + this.Lines[1 + LineIndex] + RangeIndex * 2);
    },
    
    private_Get_RangeStartPos : function(LineIndex, RangeIndex)
    { 
        return this.Lines[this.private_Get_RangeOffset(LineIndex, RangeIndex)];
    },

    private_Get_RangeEndPos : function(LineIndex, RangeIndex)
    {
        return this.Lines[this.private_Get_RangeOffset(LineIndex, RangeIndex) + 1];
    },
    
    private_Get_LinesCount : function()
    {
        return this.Lines[0];
    },
    
    private_Get_RangesCount : function(LineIndex)
    {
        if (LineIndex === this.Lines[0] - 1)
            return (this.Lines.length - this.Lines[1 + LineIndex]) / 2;
        else
            return (this.Lines[1 + LineIndex + 1] - this.Lines[1 + LineIndex]) / 2;
    }    
};

function CParagraphRunElements(ContentPos, Count)
{
    this.ContentPos = ContentPos;
    this.Elements   = [];
    this.Count      = Count;
}

function CParagraphStatistics(Stats)
{
    this.Stats          = Stats;
    this.EmptyParagraph = true;
    this.Word           = false;

    this.Symbol  = false;
    this.Space   = false;
    this.NewWord = false;
}

function CParagraphMinMaxContentWidth()
{
    this.bWord        = false;
    this.nWordLen     = 0;
    this.nSpaceLen    = 0;
    this.nMinWidth    = 0;
    this.nMaxWidth    = 0;
    this.nCurMaxWidth = 0;
}

function CParagraphRangeVisibleWidth()
{
    this.End = false;
    this.W   = 0;
}

function CParagraphRecalculateObject()
{
    this.X      = 0;
    this.Y      = 0;
    this.XLimit = 0;
    this.YLimit = 0;

    this.Pages   = [];
    this.Lines   = [];
    this.Content = [];
}

CParagraphRecalculateObject.prototype =
{
    Save : function(Para)
    {
        this.X      = Para.X;
        this.Y      = Para.Y;
        this.XLimit = Para.XLimit;
        this.YLimit = Para.YLimit;

        this.Pages  = Para.Pages;
        this.Lines  = Para.Lines;

        var Content = Para.Content;
        var Count = Content.length;
        for ( var Index = 0; Index < Count; Index++ )
        {
            this.Content[Index] = Content[Index].Save_RecalculateObject();
        }
    },

    Load : function(Para)
    {
        Para.X      = this.X;
        Para.Y      = this.Y;
        Para.XLimit = this.XLimit;
        Para.YLimit = this.YLimit;

        Para.Pages = this.Pages;
        Para.Lines = this.Lines;

        var Count = Para.Content.length;
        for ( var Index = 0; Index < Count; Index++ )
        {
            Para.Content[Index].Load_RecalculateObject(this.Content[Index], Para);
        }
    },

    Get_DrawingFlowPos : function(FlowPos)
    {
        var Count = this.Content.length;
        for ( var Index = 0; Index < Count; Index++ )
        {
            this.Content[Index].Get_DrawingFlowPos( FlowPos );
        }
    }
};

function CParagraphMathRangeChecker()
{
    this.Math   = null; // Искомый элемент
    this.Result = true; // Если есть отличные от Math элементы, тогда false, если нет, тогда true 
}

function CParagraphMathParaChecker()
{
    this.Found     = false;
    this.Result    = true;
    this.Direction = 0;
}


function CParagraphStartState(Paragraph)
{
    this.Pr = Paragraph.Pr.Copy();
    this.TextPr = Paragraph.TextPr;
    this.Content = [];
    for(var i = 0; i < Paragraph.Content.length; ++i)
    {
        this.Content.push(Paragraph.Content[i]);
    }
}

function CParagraphTabsCounter()
{
    this.Count = 0;
    this.Pos   = [];
}